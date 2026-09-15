type ChannelFreeze = {
  refreshNeeded?: boolean;
  publishFrozenUntil?: string | Date | null;
  publishFreezeReason?: string | null;
};

export function channelFreezeVisibility(
  channel: ChannelFreeze,
  now: Date = new Date()
): { until: Date; reason: string } | null {
  if (channel.refreshNeeded || !channel.publishFrozenUntil) return null;
  const until = new Date(channel.publishFrozenUntil);
  if (!Number.isFinite(until.getTime()) || until <= now) return null;
  return {
    until,
    reason:
      channel.publishFreezeReason || 'Publishing paused by the social network.',
  };
}

export function queuedPostDeferReason(post: {
  state?: string | null;
  deferReason?: string | null;
}): string | null {
  if (post.state !== 'QUEUE') return null;
  const reason = post.deferReason?.trim();
  return reason || null;
}
