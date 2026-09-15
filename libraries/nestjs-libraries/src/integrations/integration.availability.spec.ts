import { getIntegrationAvailability } from './integration.availability';

describe('integration availability', () => {
  it('keeps configured Facebook and TikTok providers available', () => {
    const environment = {
      FACEBOOK_APP_ID: 'facebook-id',
      FACEBOOK_APP_SECRET: 'facebook-secret',
      TIKTOK_CLIENT_ID: 'tiktok-id',
      TIKTOK_CLIENT_SECRET: 'tiktok-secret',
    };

    expect(getIntegrationAvailability('facebook', environment)).toEqual({
      configured: true,
    });
    expect(getIntegrationAvailability('instagram', environment)).toEqual({
      configured: true,
    });
    expect(getIntegrationAvailability('tiktok', environment)).toEqual({
      configured: true,
    });
  });

  it('marks an unconfigured LinkedIn provider as waiting for approval', () => {
    expect(getIntegrationAvailability('linkedin', {})).toEqual({
      configured: false,
      approvalStatus: 'waiting-for-approval',
      availabilityMessage: 'Waiting for approval',
    });
  });

  it('requires both credentials before enabling a provider', () => {
    expect(
      getIntegrationAvailability('linkedin-page', {
        LINKEDIN_CLIENT_ID: 'linkedin-id',
      })
    ).toMatchObject({ configured: false });
  });

  it('does not disable providers that do not use a managed developer app', () => {
    expect(getIntegrationAvailability('bluesky', {})).toEqual({
      configured: true,
    });
  });
});
