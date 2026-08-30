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
   *
   * A live verdict is never cached: a platform sign-out must end the studio
   * session on the very next request, not after a cache window. Only a dead
   * verdict is remembered (sign-out is final), which keeps a stale frame from
   * hammering the platform.
   */
  async isSessionActive(sid: string): Promise<boolean> {
    if (!OmniaPlatformService.configured || !sid) return false;
    const key = `omnia-session:${sid}`;
    const cached = await ioRedis.get(key);
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
      // Unreachable platform: refuse this request (fail closed) but do not
      // remember the refusal — the next request asks again.
      this.log.warn(`platform session check failed for ${sid}: ${(err as Error).message}`);
      return false;
    }
    if (!active) await ioRedis.set(key, '0', 'EX', 60);
    return active;
  }

  /** Forget a cached verdict — used right after a login exchange. */
  async forgetSession(sid: string) {
    await ioRedis.del(`omnia-session:${sid}`);
  }

  /**
   * Push a channel's credential to the platform vault. Asynchronous — publishing
   * never waits on the platform — and retried (three attempts over ~30 s) so a
   * platform restart during a connect or a token refresh does not leave the
   * vault behind; after that it is a log line, not a broken connect.
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
      | 'refreshNeeded'
      | 'inBetweenSteps'
    >
  ) {
    if (!OmniaPlatformService.configured) return;
    // A page-based provider (Facebook, LinkedIn page, YouTube…) is not a channel
    // until the page is chosen: the user-level token of step one is never mirrored.
    if (integration.inBetweenSteps) return;
    void (async () => {
      const tenantId = await this.tenantOf(integration.organizationId).catch(() => null);
      if (!tenantId) return; // not an Omnia-bridged workspace: nothing to mirror
      const body = JSON.stringify({
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
            refreshNeeded: !!integration.refreshNeeded,
            deleted: !!integration.deletedAt,
      });
      const label = `${integration.providerIdentifier}/${integration.internalId}`;
      for (const wait of [0, 2000, 20000]) {
        if (wait) await new Promise((r) => setTimeout(r, wait));
        try {
          const res = await fetch(`${this.base}/api/social/channels`, {
            method: 'POST',
            headers: this.headers(),
            signal: AbortSignal.timeout(8000),
            body,
          });
          if (res.ok) return;
          // 4xx is the platform's verdict (bad payload, unknown tenant): retrying will not change it.
          if (res.status < 500) {
            this.log.warn(`platform refused channel ${label}: ${res.status}`);
            return;
          }
          this.log.warn(`platform answered ${res.status} for channel ${label}; retrying`);
        } catch (err) {
          this.log.warn(`channel mirror failed for ${label}: ${(err as Error).message}; retrying`);
        }
      }
      this.log.error(`channel ${label} is NOT mirrored to the platform vault after 3 attempts`);
    })();
  }

  /** Every channel of an organization — for bulk state changes. */
  async mirrorOrganization(organizationId: string) {
    if (!OmniaPlatformService.configured) return;
    const rows = await this._prisma.model.integration.findMany({ where: { organizationId } });
    for (const row of rows) this.mirrorChannel(row);
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
