import { Injectable, Logger } from '@nestjs/common';
import { Integration } from '@prisma/client';
import { PrismaRepository } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';
import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';

/**
 * Omnia: the platform is the only identity for the studio (OMN-35).
 *
 * Two server-to-server calls, both guarded by the shared secret the platform
 * already uses for the session bridge (`OMNIA_SSO_SECRET`):
 *
 *  - `isSessionActive(sid)` — a studio session is a projection of a platform
 *    session; the middleware asks the platform whether that session still
 *    exists (answer cached in Redis for a few seconds, negative answers too).
 *  - `mirrorChannel(...)` — when a channel is connected, refreshed, disabled
 *    or removed, its credential goes to the platform vault (tenant-scoped) so
 *    other Omnia modules can reuse it. The studio keeps its own copy for
 *    publishing; the platform is the store other modules read.
 *
 * Off (fail closed for sessions, no-op for channels) when the env is missing.
 */
@Injectable()
export class OmniaPlatformService {
  private readonly log = new Logger('OmniaPlatform');
  constructor(private _prisma: PrismaRepository<'userOrganization' | 'integration'>) {}

  static get configured() {
    return !!(process.env.OMNIA_PLATFORM_INTERNAL_URL && process.env.OMNIA_SSO_SECRET);
  }

  private get base() {
    return (process.env.OMNIA_PLATFORM_INTERNAL_URL || '').replace(/\/+$/, '');
  }

  private headers() {
    return {
      'content-type': 'application/json',
      'x-omnia-sso-secret': process.env.OMNIA_SSO_SECRET || '',
    };
  }

  /** The platform tenant an organization belongs to: the binding lives on its bridge users. */
  async tenantOf(organizationId: string): Promise<string | null> {
    const link = await this._prisma.model.userOrganization.findFirst({
      where: { organizationId, user: { providerId: { startsWith: 'omnia:' } } },
      select: { user: { select: { providerId: true } } },
    });
    const providerId = link?.user?.providerId || '';
    return providerId.startsWith('omnia:') ? providerId.slice('omnia:'.length) : null;
  }

  /**
   * True only when the platform says the session row still exists and has not
   * expired. Unreachable platform or missing config → false: a studio session
   * never outlives what the platform can vouch for.
   */
  async isSessionActive(sid: string): Promise<boolean> {
    if (!OmniaPlatformService.configured || !sid) return false;
    const key = `omnia-session:${sid}`;
    const cached = await ioRedis.get(key);
    if (cached === '1') return true;
    if (cached === '0') return false;
    let active = false;
    try {
      const res = await fetch(
        `${this.base}/api/social/studio-session/check?sid=${encodeURIComponent(sid)}`,
        { headers: this.headers(), signal: AbortSignal.timeout(5000) }
      );
      if (res.ok) {
        const body = (await res.json()) as { active?: boolean };
        active = body?.active === true;
      }
    } catch (err) {
      this.log.warn(`platform session check failed for ${sid}: ${(err as Error).message}`);
    }
    // A live answer is good for 15 s; a dead one for 60 s (sign-out is final).
    await ioRedis.set(key, active ? '1' : '0', 'EX', active ? 15 : 60);
    return active;
  }

  /** Forget a cached verdict — used right after a login exchange. */
  async forgetSession(sid: string) {
    await ioRedis.del(`omnia-session:${sid}`);
  }

  /**
   * Push a channel's credential to the platform vault. Best effort and
   * asynchronous: publishing never waits on the platform, and a failure is a
   * log line, not a broken connect.
   */
  mirrorChannel(
    integration: Pick<
      Integration,
      | 'id'
      | 'organizationId'
      | 'internalId'
      | 'providerIdentifier'
      | 'name'
      | 'picture'
      | 'token'
      | 'refreshToken'
      | 'tokenExpiration'
      | 'disabled'
      | 'deletedAt'
      | 'profile'
    >
  ) {
    if (!OmniaPlatformService.configured) return;
    void (async () => {
      try {
        const tenantId = await this.tenantOf(integration.organizationId);
        if (!tenantId) return; // not an Omnia-bridged workspace: nothing to mirror
        const res = await fetch(`${this.base}/api/social/channels`, {
          method: 'POST',
          headers: this.headers(),
          signal: AbortSignal.timeout(8000),
          body: JSON.stringify({
            tenantId,
            studioOrganizationId: integration.organizationId,
            studioIntegrationId: integration.id,
            provider: integration.providerIdentifier,
            internalId: integration.internalId,
            name: integration.name,
            picture: integration.picture || null,
            profile: integration.profile || null,
            token: integration.token,
            refreshToken: integration.refreshToken || null,
            tokenExpiresAt: integration.tokenExpiration
              ? new Date(integration.tokenExpiration).toISOString()
              : null,
            disabled: !!integration.disabled,
            deleted: !!integration.deletedAt,
          }),
        });
        if (!res.ok) {
          this.log.warn(
            `platform refused channel ${integration.providerIdentifier}/${integration.internalId}: ${res.status}`
          );
        }
      } catch (err) {
        this.log.warn(`channel mirror failed: ${(err as Error).message}`);
      }
    })();
  }

  /** Re-read the row and mirror it — for the state changes (disable / enable / delete). */
  async mirrorChannelById(integrationId: string) {
    if (!OmniaPlatformService.configured) return;
    const row = await this._prisma.model.integration.findFirst({
      where: { id: integrationId },
    });
    if (row) this.mirrorChannel(row);
  }
}
