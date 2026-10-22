export type AgreementInputs = {
  templateId: string;
  assetId: string;
  campaign: string;
  partner: string;
  platforms: string[];
  territory: string;
  durationDays: number;
  paidUse: boolean;
  assetVerdict: 'CLEARED' | 'REVIEW' | 'BLOCKED';
  creatorLicenseActive: boolean;
};

export type AgreementResult = {
  status: 'READY' | 'REVIEW' | 'BLOCKED';
  lockedPercentage: number;
  templateVersion: string;
  reasons: string[];
};

const allowedPlatforms = new Set(['Instagram', 'TikTok', 'X', 'YouTube']);
const allowedTerritories = new Set(['United States', 'North America', 'Worldwide']);

export function validateAgreement(input: AgreementInputs): AgreementResult {
  const blocked: string[] = [];
  const review: string[] = [];

  if (input.templateId !== 'clear-ugc-brand-1.0') blocked.push('UNAPPROVED_TEMPLATE');
  if (!input.assetId) blocked.push('ASSET_REQUIRED');
  if (!input.campaign.trim() || !input.partner.trim()) blocked.push('DEAL_FACTS_REQUIRED');
  if (!input.creatorLicenseActive) blocked.push('CREATOR_LICENSE_INACTIVE');
  if (input.assetVerdict === 'BLOCKED') blocked.push('ASSET_BLOCKED');
  if (input.assetVerdict === 'REVIEW') review.push('ASSET_REQUIRES_REVIEW');
  if (input.platforms.length === 0 || input.platforms.some(platform => !allowedPlatforms.has(platform))) blocked.push('PLATFORM_OUTSIDE_TEMPLATE');
  if (!allowedTerritories.has(input.territory)) blocked.push('TERRITORY_OUTSIDE_TEMPLATE');
  if (input.durationDays < 1 || input.durationDays > 180) blocked.push('DURATION_OUTSIDE_TEMPLATE');
  if (input.paidUse) review.push('PAID_MEDIA_ADDENDUM_REQUIRED');

  return {
    status: blocked.length ? 'BLOCKED' : review.length ? 'REVIEW' : 'READY',
    lockedPercentage: 80,
    templateVersion: 'clear-ugc-brand-1.0',
    reasons: blocked.length ? blocked : review.length ? review : ['ALL_GUARDRAILS_PASS'],
  };
}

