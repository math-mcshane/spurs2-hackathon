import assert from 'node:assert/strict';
import { evaluateRights } from '../lib/compliance.ts';

const base = {
  consentAccepted: true,
  ownershipAttested: true,
  expiresAt: '2027-10-22T00:00:00Z',
  requestedPlatform: 'Instagram',
  allowedPlatforms: ['Instagram', 'TikTok', 'X'],
  requestedTerritory: 'United States',
  allowedTerritories: ['Worldwide'],
  paidRequested: false,
  paidAllowed: false,
  thirdPartyRights: 'none',
};
const now = new Date('2026-10-22T12:00:00Z');
const cases = [
  ['baseline clears', {}, 'CLEARED'],
  ['missing consent blocks', { consentAccepted: false }, 'BLOCKED'],
  ['missing ownership blocks', { ownershipAttested: false }, 'BLOCKED'],
  ['expired license blocks', { expiresAt: '2026-09-30T00:00:00Z' }, 'BLOCKED'],
  ['unsupported platform blocks', { requestedPlatform: 'YouTube' }, 'BLOCKED'],
  ['unsupported territory blocks', { allowedTerritories: ['United States'], requestedTerritory: 'United Kingdom' }, 'BLOCKED'],
  ['unlicensed paid use blocks', { paidRequested: true }, 'BLOCKED'],
  ['ambiguous third-party rights review', { thirdPartyRights: 'ambiguous' }, 'REVIEW'],
  ['possible minor reviews', { minorDetected: true }, 'REVIEW'],
  ['music signal reviews', { musicDetected: true }, 'REVIEW'],
  ['confirmed conflict blocks', { thirdPartyRights: 'confirmed' }, 'BLOCKED'],
];

for (const [name, override, expected] of cases) {
  const actual = evaluateRights({ ...base, ...override }, now).verdict;
  assert.equal(actual, expected, `${name}: expected ${expected}, got ${actual}`);
  console.log(`✓ ${name} → ${actual}`);
}
console.log(`\n${cases.length}/${cases.length} policy evaluations passed.`);
