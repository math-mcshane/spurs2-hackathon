export type Verdict = 'CLEARED' | 'REVIEW' | 'BLOCKED';

export interface RightsInput {
  consentAccepted: boolean;
  ownershipAttested: boolean;
  expiresAt: string;
  requestedPlatform: string;
  allowedPlatforms: string[];
  requestedTerritory: string;
  allowedTerritories: string[];
  paidRequested: boolean;
  paidAllowed: boolean;
  thirdPartyRights: 'none' | 'ambiguous' | 'confirmed';
  minorDetected?: boolean;
  musicDetected?: boolean;
}

export interface RightsDecision {
  verdict: Verdict;
  reasons: string[];
  policyVersion: string;
}

export function evaluateRights(input: RightsInput, now = new Date()): RightsDecision {
  const blocked: string[] = [];
  const review: string[] = [];
  if (!input.consentAccepted) blocked.push('Creator consent is missing');
  if (!input.ownershipAttested) blocked.push('Ownership attestation is missing');
  if (new Date(input.expiresAt).getTime() <= now.getTime()) blocked.push('License has expired');
  if (!input.allowedPlatforms.includes(input.requestedPlatform)) blocked.push(`Platform ${input.requestedPlatform} is outside license scope`);
  if (!input.allowedTerritories.includes('Worldwide') && !input.allowedTerritories.includes(input.requestedTerritory)) blocked.push(`Territory ${input.requestedTerritory} is outside license scope`);
  if (input.paidRequested && !input.paidAllowed) blocked.push('Paid media use is not licensed');
  if (input.thirdPartyRights === 'confirmed') blocked.push('Confirmed third-party rights conflict');
  if (input.thirdPartyRights === 'ambiguous') review.push('Third-party rights are ambiguous');
  if (input.minorDetected) review.push('A possible minor requires human review');
  if (input.musicDetected) review.push('Music may require separate clearance');
  if (blocked.length) return { verdict: 'BLOCKED', reasons: blocked, policyVersion: 'clear-policy-2026.10' };
  if (review.length) return { verdict: 'REVIEW', reasons: review, policyVersion: 'clear-policy-2026.10' };
  return { verdict: 'CLEARED', reasons: ['Consent, ownership, requested use, and license term are valid'], policyVersion: 'clear-policy-2026.10' };
}
