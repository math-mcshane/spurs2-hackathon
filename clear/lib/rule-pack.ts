import type { Verdict } from './compliance';

export const NBA_RULE_PACK = {
  id: 'nba-media-rights-audit',
  version: '1.0.0',
  status: 'draft',
} as const;

export type EvidenceFinding = {
  ruleId: string;
  outcome: 'PASS' | 'AMBIGUOUS' | 'CONFLICT';
  citation?: { startSeconds: number; endSeconds: number };
};

export type RulePackInput = {
  consentComplete: boolean;
  licenseActive: boolean;
  requestInScope: boolean;
  requiredMetadataComplete: boolean;
  findings: EvidenceFinding[];
};

export type RulePackDecision = {
  verdict: Verdict;
  reasonCodes: string[];
  rulePackId: string;
  rulePackVersion: string;
};

export function evaluateRulePack(input: RulePackInput): RulePackDecision {
  const blocked: string[] = [];
  const review: string[] = [];

  if (!input.consentComplete) blocked.push('CONSENT_MISSING');
  if (!input.licenseActive) blocked.push('LICENSE_EXPIRED');
  if (!input.requestInScope) blocked.push('REQUEST_OUT_OF_SCOPE');
  if (!input.requiredMetadataComplete) review.push('REQUIRED_METADATA_MISSING');

  for (const finding of input.findings) {
    if (finding.outcome !== 'PASS' && !finding.citation) {
      review.push(`${finding.ruleId}:CITATION_MISSING`);
      continue;
    }
    if (finding.outcome === 'CONFLICT') blocked.push(`${finding.ruleId}:CONFLICT`);
    if (finding.outcome === 'AMBIGUOUS') review.push(`${finding.ruleId}:AMBIGUOUS`);
  }

  return {
    verdict: blocked.length ? 'BLOCKED' : review.length ? 'REVIEW' : 'CLEARED',
    reasonCodes: blocked.length ? blocked : review.length ? review : ['ALL_REQUIRED_RULES_PASS'],
    rulePackId: NBA_RULE_PACK.id,
    rulePackVersion: NBA_RULE_PACK.version,
  };
}
