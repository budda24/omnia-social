import { TiktokProvider } from './tiktok.provider';

const provider = new TiktokProvider();
const media = [[{ path: 'https://app.omnia-inteligance.com/social/uploads/a.mp4' }]];

const settings = {
  content_posting_method: 'DIRECT_POST',
  privacy_level: 'SELF_ONLY',
  comment: false,
  duet: false,
  stitch: false,
  disclose: false,
  brand_content_toggle: false,
  brand_organic_toggle: false,
  music_usage_consent: true,
};

describe('TikTok Direct Post audit requirements', () => {
  it('requires deliberate privacy and music consent', async () => {
    expect(await provider.checkValidity(media, { ...settings, privacy_level: '' } as any))
      .toMatch(/privacy/);
    expect(await provider.checkValidity(media, { ...settings, music_usage_consent: false } as any))
      .toMatch(/music usage/);
  });

  it('rejects inconsistent commercial disclosure', async () => {
    expect(await provider.checkValidity(media, { ...settings, disclose: true } as any))
      .toMatch(/Select Your brand/);
    expect(await provider.checkValidity(media, {
      ...settings, disclose: true, brand_content_toggle: true,
    } as any)).toMatch(/public or friends/);
  });

  it('uses pull from owned storage for server-hosted videos', () => {
    const post = { media: media[0], settings };
    expect((provider as any).buildTikokSourceInfoBody(post)).toEqual({
      source_info: { source: 'PULL_FROM_URL', video_url: media[0][0].path },
    });
  });

  it('rechecks current account options before posting', async () => {
    const creatorInfo = jest.spyOn(provider, 'creatorInfo').mockResolvedValue({
      creator_nickname: 'Creator', creator_username: 'creator',
      privacy_level_options: ['SELF_ONLY'], comment_disabled: true,
      duet_disabled: false, stitch_disabled: false, max_video_post_duration_sec: 300,
    });
    expect(await provider.validateDirectPost('token', {
      ...settings, privacy_level: 'PUBLIC_TO_EVERYONE',
    } as any, 'photo.jpg')).toMatch(/privacy/);
    expect(await provider.validateDirectPost('token', {
      ...settings, comment: true,
    } as any, 'photo.jpg')).toMatch(/comments are disabled/);
    creatorInfo.mockRestore();
  });
});
