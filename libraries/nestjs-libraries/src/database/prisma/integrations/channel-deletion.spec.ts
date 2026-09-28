jest.mock('@gitroom/nestjs-libraries/integrations/integration.manager', () => ({
  IntegrationManager: class IntegrationManager {},
}));

import { IntegrationRepository } from './integration.repository';
import { IntegrationService } from './integration.service';
import { TiktokProvider } from '@gitroom/nestjs-libraries/integrations/social/tiktok.provider';

describe('channel deletion', () => {
  it('erases stored tokens and account data while retaining a post-history tombstone', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'row-1',
      internalId: 'deleted_row-1',
      deletedAt: new Date(),
    });
    const repository = Object.create(IntegrationRepository.prototype) as any;
    repository._integration = { model: { integration: { update } } };

    await repository.deleteChannel('org-1', 'row-1');

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'row-1', organizationId: 'org-1' },
        data: expect.objectContaining({
          token: '',
          refreshToken: null,
          tokenExpiration: null,
          internalId: 'deleted_row-1',
          rootInternalId: null,
          name: 'Deleted channel',
          picture: null,
          profile: null,
          additionalSettings: '[]',
          customInstanceDetails: null,
          customerId: null,
        }),
      })
    );
  });

  it('erases the platform credential before scrubbing the studio row', async () => {
    const mirrorChannel = jest.fn().mockResolvedValue(true);
    const deleteChannel = jest
      .fn()
      .mockResolvedValue({ id: 'row-1', internalId: 'deleted_row-1' });
    const service = Object.create(IntegrationService.prototype) as any;
    service._integrationRepository = {
      getIntegrationById: jest.fn().mockResolvedValue({
        id: 'row-1',
        internalId: 'old-account',
        token: 'old-token',
        refreshToken: 'old-refresh',
      }),
      deleteChannel,
    };
    service._omnia = { mirrorChannel };

    await service.deleteChannel('org-1', 'row-1');

    expect(mirrorChannel).toHaveBeenCalledWith(
      expect.objectContaining({
        internalId: 'old-account',
        token: '',
        refreshToken: null,
        deletedAt: expect.any(Date),
      })
    );
    expect(mirrorChannel.mock.invocationCallOrder[0]).toBeLessThan(
      deleteChannel.mock.invocationCallOrder[0]
    );
  });

  it('keeps the studio credential for a retry if the platform cannot delete its copy', async () => {
    const service = Object.create(IntegrationService.prototype) as any;
    const deleteChannel = jest.fn();
    service._integrationRepository = {
      getIntegrationById: jest
        .fn()
        .mockResolvedValue({ id: 'row-1', internalId: 'old-account' }),
      deleteChannel,
    };
    service._omnia = { mirrorChannel: jest.fn().mockResolvedValue(false) };

    await expect(service.deleteChannel('org-1', 'row-1')).rejects.toThrow(
      'could not reach the platform'
    );
    expect(deleteChannel).not.toHaveBeenCalled();
  });

  it('shows TikTok authorization again when connecting an account', async () => {
    const { url } = await new TiktokProvider().generateAuthUrl();
    expect(new URL(url).searchParams.get('disable_auto_auth')).toBe('1');
  });
});
