import type { PublishPacing } from '@gitroom/nestjs-libraries/integrations/social/social.integrations.interface';

export function temporalDate(value: Date | string, name = 'Temporal date') {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError(`Invalid ${name}: ${String(value)}`);
  }
  return date;
}

export type PublishPacingInput = {
  now: Date;
  publishFrozenUntil?: Date | null;
  publishFreezeReason?: string | null;
  nextPublishAllowedAt?: Date | null;
  pacing?: PublishPacing;
  publishedAt?: Date[];
  tenantQuota?: {
    used: number;
    limit: number;
    nextAllowedAt: Date;
  };
  globalQuota?: {
    providerFamily: string;
    used: number;
    limit: number;
    nextAllowedAt: Date;
  };
};

export type PublishPacingDecision =
  | { type: 'claim'; leaseUntil: Date }
  | {
      type: 'defer';
      deferUntil: Date;
      reason: string;
      jitterWindowMs: number;
    };

const positive = (value: number | undefined) =>
  Number.isFinite(value) && Number(value) > 0 ? Number(value) : undefined;

export function resolvePacing({
  now,
  publishFrozenUntil,
  publishFreezeReason,
  nextPublishAllowedAt,
  pacing = {},
  publishedAt = [],
  tenantQuota,
  globalQuota,
}: PublishPacingInput): PublishPacingDecision {
  const nowMs = now.getTime();
  const minIntervalMinutes = positive(pacing.minIntervalMinutes) || 0;
  const jitterWindowMs = Math.floor((minIntervalMinutes * 60_000) / 2);
  const frozenUntilMs = publishFrozenUntil?.getTime() || 0;

  if (frozenUntilMs > nowMs) {
    return {
      type: 'defer',
      deferUntil: new Date(frozenUntilMs),
      reason: `Channel frozen until ${new Date(frozenUntilMs).toISOString()}${
        publishFreezeReason ? `: ${publishFreezeReason}` : ''
      }`,
      jitterWindowMs,
    };
  }

  if (
    tenantQuota &&
    tenantQuota.limit > 0 &&
    tenantQuota.used >= tenantQuota.limit
  ) {
    return {
      type: 'defer',
      deferUntil: tenantQuota.nextAllowedAt,
      reason: `Tenant daily publish quota reached (${tenantQuota.used}/${tenantQuota.limit})`,
      jitterWindowMs,
    };
  }

  if (
    globalQuota &&
    globalQuota.limit > 0 &&
    globalQuota.used >= globalQuota.limit
  ) {
    return {
      type: 'defer',
      deferUntil: globalQuota.nextAllowedAt,
      reason: `${globalQuota.providerFamily} app daily publish cap reached (${globalQuota.used}/${globalQuota.limit})`,
      jitterWindowMs,
    };
  }

  const weekly = positive(pacing.weekly);
  const weekStartMs = nowMs - 7 * 24 * 60 * 60_000;
  const weekPosts = publishedAt
    .filter((date) => date.getTime() >= weekStartMs && date.getTime() <= nowMs)
    .sort((a, b) => a.getTime() - b.getTime());
  if (weekly && weekPosts.length >= weekly) {
    const openingPost = weekPosts[weekPosts.length - weekly];
    return {
      type: 'defer',
      deferUntil: new Date(openingPost.getTime() + 7 * 24 * 60 * 60_000),
      reason: `Channel weekly publish limit reached (${weekPosts.length}/${weekly})`,
      jitterWindowMs,
    };
  }

  const daily = positive(pacing.daily);
  const dayStartMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate()
  );
  const dayPosts = publishedAt.filter(
    (date) => date.getTime() >= dayStartMs && date.getTime() <= nowMs
  );
  if (daily && dayPosts.length >= daily) {
    return {
      type: 'defer',
      deferUntil: new Date(dayStartMs + 24 * 60 * 60_000),
      reason: `Channel daily publish limit reached (${dayPosts.length}/${daily})`,
      jitterWindowMs,
    };
  }

  const nextAllowedMs = nextPublishAllowedAt?.getTime() || 0;
  if (nextAllowedMs > nowMs) {
    return {
      type: 'defer',
      deferUntil: new Date(nextAllowedMs),
      reason: `Channel publish interval active until ${new Date(
        nextAllowedMs
      ).toISOString()}`,
      jitterWindowMs,
    };
  }

  return {
    type: 'claim',
    leaseUntil: new Date(nowMs + minIntervalMinutes * 60_000),
  };
}

export const envPositive = (name: string) =>
  positive(Number(process.env[name]));
