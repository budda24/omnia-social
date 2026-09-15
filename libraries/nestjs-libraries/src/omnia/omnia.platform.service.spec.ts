import { ioRedis } from '@gitroom/nestjs-libraries/redis/redis.service';
import { OmniaPlatformService } from './omnia.platform.service';

jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

describe('Omnia tenant organizations (OMN-275)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('loads each organization once and caches the unique ids for 60 seconds', async () => {
    (ioRedis.get as jest.Mock).mockResolvedValue(null);
    (ioRedis.set as jest.Mock).mockResolvedValue('OK');
    const findMany = jest
      .fn()
      .mockResolvedValue([
        { organizationId: 'org-1' },
        { organizationId: 'org-2' },
        { organizationId: 'org-1' },
      ]);
    const service = new OmniaPlatformService({
      model: { userOrganization: { findMany } },
    } as any);

    await expect(service.organizationsOfTenant('tenant-1')).resolves.toEqual([
      'org-1',
      'org-2',
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { user: { providerId: 'omnia:tenant-1' } },
      select: { organizationId: true },
    });
    expect(ioRedis.set).toHaveBeenCalledWith(
      'omnia-tenant-organizations:tenant-1',
      JSON.stringify(['org-1', 'org-2']),
      'EX',
      60
    );
  });

  test('uses the cached list without reading Prisma', async () => {
    (ioRedis.get as jest.Mock).mockResolvedValue(JSON.stringify(['org-2']));
    const findMany = jest.fn();
    const service = new OmniaPlatformService({
      model: { userOrganization: { findMany } },
    } as any);

    await expect(service.organizationsOfTenant('tenant-1')).resolves.toEqual([
      'org-2',
    ]);
    expect(findMany).not.toHaveBeenCalled();
  });
});
