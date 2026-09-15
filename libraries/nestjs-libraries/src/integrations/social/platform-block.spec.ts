import {
  PlatformBlock,
  SocialAbstract,
  SocialErrorResult,
} from '../social.abstract';
import { FacebookProvider } from './facebook.provider';
import { InstagramProvider } from './instagram.provider';
import { ThreadsProvider } from './threads.provider';
import { TiktokProvider } from './tiktok.provider';
import { XProvider } from './x.provider';

const provider = <T>(prototype: T): T => Object.create(prototype);

class BlockedProvider extends SocialAbstract {
  identifier = 'blocked';

  override handleErrors(): SocialErrorResult {
    return {
      type: 'platform-block',
      value: 'Provider blocked publishing',
      cooldownHours: 6,
    };
  }
}

describe('platform publishing blocks (OMN-274)', () => {
  test.each([
    [InstagramProvider.prototype, '2207051', 48],
    [InstagramProvider.prototype, '2207001', 24],
    [InstagramProvider.prototype, '2207042', 24],
    [InstagramProvider.prototype, 'Page request limit reached', 24],
    [ThreadsProvider.prototype, '2207051', 48],
    [FacebookProvider.prototype, '1390008', 6],
    [XProvider.prototype, 'usage-capped', 24],
    [TiktokProvider.prototype, 'rate_limit_exceeded', 6],
  ])('%s classifies %s as a %sh platform block', (prototype, body, hours) => {
    expect((provider(prototype) as any).handleErrors(body, 400)).toMatchObject({
      type: 'platform-block',
      cooldownHours: hours,
    });
  });

  test.each(['1346003', '1404102'])(
    'Facebook content verdict %s stays a bad body',
    (body) => {
      expect(
        provider(FacebookProvider.prototype).handleErrors(body, 400)
      ).toMatchObject({ type: 'bad-body' });
    }
  );

  test('the Temporal failure is non-retryable and carries the cooldown', () => {
    const failure = new PlatformBlock(
      'instagram',
      '{"error":"2207051"}',
      '{}',
      'Instagram restricted publishing',
      48
    );

    expect(failure.type).toBe('platform_block');
    expect(failure.nonRetryable).toBe(true);
    expect(failure.details).toEqual([
      expect.objectContaining({ identifier: 'instagram', cooldownHours: 48 }),
    ]);
  });

  test('fetch throws before its rate-limit retry branch', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('Rate limit', { status: 429 }));

    await expect(
      new BlockedProvider().fetch('https://example.com', {}, 'channel-1')
    ).rejects.toMatchObject({
      type: 'platform_block',
      details: [expect.objectContaining({ cooldownHours: 6 })],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  test('streamed uploads throw before their rate-limit retry branch', async () => {
    const upload = jest.fn().mockRejectedValue({
      response: { status: 429, data: 'Rate limit' },
    });

    await expect(
      (new BlockedProvider() as any).runStreamedUpload(upload, 'channel-1')
    ).rejects.toMatchObject({ type: 'platform_block' });
    expect(upload).toHaveBeenCalledTimes(1);
  });

  test('concurrent actions preserve the platform block', async () => {
    await expect(
      new BlockedProvider().runInConcurrent(async () => {
        throw new Error('Rate limit');
      })
    ).rejects.toMatchObject({ type: 'platform_block' });
  });
});
