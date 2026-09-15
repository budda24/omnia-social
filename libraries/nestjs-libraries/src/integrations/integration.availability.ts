type Environment = Record<string, string | undefined>;

type AvailabilityRule = {
  required: string[];
  waitingForApproval?: boolean;
};

const availabilityRules: Record<string, AvailabilityRule> = {
  facebook: {
    required: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  },
  instagram: {
    required: ['FACEBOOK_APP_ID', 'FACEBOOK_APP_SECRET'],
  },
  'instagram-standalone': {
    required: ['INSTAGRAM_APP_ID', 'INSTAGRAM_APP_SECRET'],
    waitingForApproval: true,
  },
  linkedin: {
    required: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
    waitingForApproval: true,
  },
  'linkedin-page': {
    required: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET'],
    waitingForApproval: true,
  },
  tiktok: {
    required: ['TIKTOK_CLIENT_ID', 'TIKTOK_CLIENT_SECRET'],
  },
};

export function getIntegrationAvailability(
  identifier: string,
  environment: Environment = process.env
) {
  const rule = availabilityRules[identifier];
  const configured =
    !rule || rule.required.every((key) => !!environment[key]?.trim());

  if (configured) {
    return { configured: true as const };
  }

  const approvalStatus = rule.waitingForApproval
    ? ('waiting-for-approval' as const)
    : ('not-configured' as const);

  return {
    configured: false as const,
    approvalStatus,
    availabilityMessage:
      approvalStatus === 'waiting-for-approval'
        ? 'Waiting for approval'
        : 'Not configured',
  };
}
