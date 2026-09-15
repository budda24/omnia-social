import { IntegrationRepository } from './integration.repository';
import { resolvePacing, temporalDate } from './publish-pacing';
import { IntegrationService } from './integration.service';

jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));

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

  test('a configured global provider-family cap defers to next UTC midnight', () => {
    expect(
      resolvePacing({
        now,
        globalQuota: {
          providerFamily: 'Meta',
          used: 500,
          limit: 500,
          nextAllowedAt: new Date('2026-09-16T00:00:00.000Z'),
        },
      })
    ).toEqual({
      type: 'defer',
      deferUntil: new Date('2026-09-16T00:00:00.000Z'),
      reason: 'Meta app daily publish cap reached (500/500)',
      jitterWindowMs: 0,
    });
  });

  test('counts all organizations of an Omnia tenant before claiming', async () => {
    const countPublishedPosts = jest.fn().mockResolvedValue(2);
    const claimPublishSlot = jest.fn();
    const service = Object.create(IntegrationService.prototype) as any;
    service._integrationRepository = {
      getPublishPacingSnapshot: jest.fn().mockResolvedValue({
        integration: {
          providerIdentifier: 'mastodon',
          refreshNeeded: false,
          disabled: false,
          publishLeaseHolder: null,
          publishFrozenUntil: null,
          publishFreezeReason: null,
          nextPublishAllowedAt: null,
          publishMinIntervalMinutes: null,
          publishDailyLimit: null,
          publishWeeklyLimit: null,
        },
        publishedAt: [],
      }),
      countPublishedPosts,
      claimPublishSlot,
    };
    service._integrationManager = {
      getSocialIntegration: jest.fn().mockReturnValue({ publishPacing: {} }),
    };
    service._omnia = {
      tenantOf: jest.fn().mockResolvedValue('tenant-1'),
      organizationsOfTenant: jest.fn().mockResolvedValue(['org-1', 'org-2']),
    };
    const oldLimit = process.env.OMNIA_TENANT_DAILY_PUBLISHES;
    process.env.OMNIA_TENANT_DAILY_PUBLISHES = '2';
    try {
      await expect(
        service.claimPublishSlot('org-1', 'channel-1', 'post-3', now)
      ).resolves.toMatchObject({
        claimed: false,
        type: 'defer',
        deferUntil: new Date('2026-09-16T00:00:00.000Z'),
        reason: expect.stringContaining('Tenant daily publish quota'),
      });
    } finally {
      if (oldLimit === undefined) {
        delete process.env.OMNIA_TENANT_DAILY_PUBLISHES;
      } else {
        process.env.OMNIA_TENANT_DAILY_PUBLISHES = oldLimit;
      }
    }
    expect(countPublishedPosts).toHaveBeenCalledWith(
      new Date('2026-09-15T00:00:00.000Z'),
      now,
      { organizationIds: ['org-1', 'org-2'] }
    );
    expect(claimPublishSlot).not.toHaveBeenCalled();
  });

  test('a non-Omnia organization skips the tenant quota', async () => {
    const countPublishedPosts = jest.fn();
    const claimPublishSlot = jest.fn().mockResolvedValue(true);
    const service = Object.create(IntegrationService.prototype) as any;
    service._integrationRepository = {
      getPublishPacingSnapshot: jest.fn().mockResolvedValue({
        integration: {
          providerIdentifier: 'mastodon',
          refreshNeeded: false,
          disabled: false,
          publishLeaseHolder: null,
          publishFrozenUntil: null,
          publishFreezeReason: null,
          nextPublishAllowedAt: null,
          publishMinIntervalMinutes: null,
          publishDailyLimit: null,
          publishWeeklyLimit: null,
        },
        publishedAt: [],
      }),
      countPublishedPosts,
      claimPublishSlot,
    };
    service._integrationManager = {
      getSocialIntegration: jest.fn().mockReturnValue({ publishPacing: {} }),
    };
    service._omnia = {
      tenantOf: jest.fn().mockResolvedValue(null),
      organizationsOfTenant: jest.fn(),
    };

    await expect(
      service.claimPublishSlot('external-org', 'channel-1', 'post-1', now)
    ).resolves.toEqual({
      claimed: true,
      nextPublishAllowedAt: now,
    });
    expect(countPublishedPosts).not.toHaveBeenCalled();
  });

  test('an atomic freeze only extends the active freeze', async () => {
    const frozenUntil = new Date(now.getTime() + 48 * hour);
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue({
      id: 'channel-1',
      publishFrozenUntil: frozenUntil,
    });
    const repository = Object.create(IntegrationRepository.prototype) as any;
    repository._integration = {
      model: { integration: { updateMany, findFirst } },
    };

    await expect(
      repository.freezeChannel(
        'org-1',
        'channel-1',
        frozenUntil,
        'provider block'
      )
    ).resolves.toMatchObject({ changed: true });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        organizationId: 'org-1',
        id: 'channel-1',
        deletedAt: null,
        OR: [
          { publishFrozenUntil: null },
          { publishFrozenUntil: { lt: frozenUntil } },
        ],
      },
      data: {
        publishFrozenUntil: frozenUntil,
        publishFreezeReason: 'provider block',
      },
    });
  });

  test('one freeze event mirrors and notifies only once', async () => {
    const frozenUntil = new Date(now.getTime() + 48 * hour);
    const freezeChannel = jest
      .fn()
      .mockResolvedValueOnce({
        changed: true,
        integration: {
          id: 'channel-1',
          name: 'Omnia Instagram',
          providerIdentifier: 'instagram',
        },
      })
      .mockResolvedValueOnce({
        changed: false,
        integration: {
          id: 'channel-1',
          name: 'Omnia Instagram',
          providerIdentifier: 'instagram',
          publishFrozenUntil: frozenUntil,
        },
      });
    const mirrorChannelById = jest.fn();
    const inAppNotification = jest.fn();
    const service = Object.create(IntegrationService.prototype) as any;
    service._integrationRepository = { freezeChannel };
    service._omnia = { mirrorChannelById };
    service._notificationService = { inAppNotification };

    await service.freezeChannel(
      'org-1',
      'channel-1',
      48,
      'Instagram restricted publishing',
      now
    );
    await service.freezeChannel(
      'org-1',
      'channel-1',
      48,
      'Instagram restricted publishing',
      now
    );

    expect(mirrorChannelById).toHaveBeenCalledTimes(1);
    expect(inAppNotification).toHaveBeenCalledTimes(1);
    expect(inAppNotification).toHaveBeenCalledWith(
      'org-1',
      expect.stringContaining('instagram'),
      expect.stringContaining(frozenUntil.toISOString()),
      true,
      true,
      'fail'
    );
  });
});
