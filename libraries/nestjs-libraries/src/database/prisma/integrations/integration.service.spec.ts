import { IntegrationRepository } from './integration.repository';
import { resolvePacing, temporalDate } from './publish-pacing';

describe('Social publish pacing (OMN-273)', () => {
  const now = new Date('2026-09-15T10:00:00.000Z');
  const hour = 60 * 60_000;

  test('freeze > tenant > weekly > daily > interval, then the slot is claimable', () => {
    const base = {
      now,
      publishFrozenUntil: new Date(now.getTime() + 8 * hour),
      publishFreezeReason: 'provider cooldown',
      tenantQuota: {
        used: 100,
        limit: 100,
        nextAllowedAt: new Date('2026-09-16T00:00:00.000Z'),
      },
      pacing: { minIntervalMinutes: 240, daily: 2, weekly: 5 },
      publishedAt: [
        new Date(now.getTime() - hour),
        new Date(now.getTime() - 2 * hour),
        new Date(now.getTime() - 24 * hour),
        new Date(now.getTime() - 48 * hour),
        new Date(now.getTime() - 72 * hour),
      ],
      nextPublishAllowedAt: new Date(now.getTime() + hour),
    };

    expect(resolvePacing(base)).toMatchObject({
      type: 'defer',
      reason: expect.stringContaining('Channel frozen'),
    });
    expect(resolvePacing({ ...base, publishFrozenUntil: null })).toMatchObject({
      type: 'defer',
      reason: expect.stringContaining('Tenant daily publish quota'),
    });
    expect(
      resolvePacing({
        ...base,
        publishFrozenUntil: null,
        tenantQuota: undefined,
      })
    ).toMatchObject({
      type: 'defer',
      reason: expect.stringContaining('weekly publish limit'),
    });
    expect(
      resolvePacing({
        ...base,
        publishFrozenUntil: null,
        tenantQuota: undefined,
        pacing: { minIntervalMinutes: 240, daily: 2 },
      })
    ).toMatchObject({
      type: 'defer',
      deferUntil: new Date('2026-09-16T00:00:00.000Z'),
      reason: expect.stringContaining('daily publish limit'),
    });
    expect(
      resolvePacing({
        ...base,
        publishFrozenUntil: null,
        tenantQuota: undefined,
        pacing: { minIntervalMinutes: 240 },
        publishedAt: [],
      })
    ).toMatchObject({
      type: 'defer',
      deferUntil: base.nextPublishAllowedAt,
      reason: expect.stringContaining('publish interval'),
    });
    expect(
      resolvePacing({
        now,
        pacing: { minIntervalMinutes: 240 },
      })
    ).toEqual({
      type: 'claim',
      leaseUntil: new Date(now.getTime() + 4 * hour),
    });
  });

  test('the atomic claim keeps the freeze and lease checks inside one update', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const repository = Object.create(IntegrationRepository.prototype) as any;
    repository._integration = {
      model: { integration: { updateMany } },
    };
    const leaseUntil = new Date(now.getTime() + hour);

    await expect(
      repository.claimPublishSlot(
        'org-1',
        'channel-1',
        'post-1',
        now,
        leaseUntil
      )
    ).resolves.toBe(true);
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        id: 'channel-1',
        deletedAt: null,
        disabled: false,
        refreshNeeded: false,
        OR: [
          { publishLeaseHolder: 'post-1' },
          {
            AND: [
              {
                OR: [
                  { nextPublishAllowedAt: null },
                  { nextPublishAllowedAt: { lte: now } },
                ],
              },
              {
                OR: [
                  { publishFrozenUntil: null },
                  { publishFrozenUntil: { lte: now } },
                ],
              },
            ],
          },
        ],
      },
      data: {
        nextPublishAllowedAt: leaseUntil,
        publishLeaseHolder: 'post-1',
      },
    });
  });

  test('normalizes the ISO timestamps transported by Temporal', () => {
    expect(temporalDate(now.toISOString())).toEqual(now);
    expect(temporalDate(now)).toBe(now);
    expect(() => temporalDate('not-a-date', 'publish attempt date')).toThrow(
      'Invalid publish attempt date'
    );
  });
});
