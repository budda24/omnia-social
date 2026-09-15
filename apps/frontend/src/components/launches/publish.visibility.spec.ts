import {
  channelFreezeVisibility,
  queuedPostDeferReason,
} from './publish.visibility';

describe('publish visibility (OMN-276)', () => {
  const now = new Date('2026-09-15T18:00:00.000Z');

  it('shows a future freeze with its reason', () => {
    expect(
      channelFreezeVisibility(
        {
          publishFrozenUntil: '2026-09-15T20:00:00.000Z',
          publishFreezeReason: 'Meta asked this account to cool down.',
        },
        now
      )
    ).toEqual({
      until: new Date('2026-09-15T20:00:00.000Z'),
      reason: 'Meta asked this account to cool down.',
    });
  });

  it('lets reconnect state win and hides expired freezes', () => {
    expect(
      channelFreezeVisibility(
        { refreshNeeded: true, publishFrozenUntil: '2026-09-15T20:00:00.000Z' },
        now
      )
    ).toBeNull();
    expect(
      channelFreezeVisibility(
        { publishFrozenUntil: '2026-09-15T17:59:59.000Z' },
        now
      )
    ).toBeNull();
  });

  it('shows defer reasons only for queued posts', () => {
    expect(
      queuedPostDeferReason({
        state: 'QUEUE',
        deferReason: 'Next slot is 10:30.',
      })
    ).toBe('Next slot is 10:30.');
    expect(
      queuedPostDeferReason({ state: 'PUBLISHED', deferReason: 'old reason' })
    ).toBeNull();
  });
});
