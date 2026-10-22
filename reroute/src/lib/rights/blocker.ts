/**
 * What stands between a segment and ALLOWED, and whether swapping the clip can help.
 * CLIP = tied to this footage (people, brands, asset tags, evidence, media identity, its club/provenance).
 * CAMPAIGN = tied to the publish intent (territory, platform, usage, date, no policy for the publisher):
 * every clip fails the same way, so the fix is a different intent, not a different clip.
 */
import type { Blocker, Decision, PublishIntent, Reason } from "@/lib/contracts";
import { ASSET_BOUND_MATCH_KEYS, type Policy, type Rule } from "./policy";
import { BUNDLED_POLICIES } from "./registry";

const CLIP_DIMENSIONS: Record<string, true> = { people: true, sponsor: true, competition: true, club: true, provenance: true, media: true };

function findRule(ruleId: string, policies: readonly Policy[]): { policy: Policy; rule: Rule } | undefined {
  for (const policy of policies) {
    const rule = policy.rules.find((r) => r.id === ruleId);
    if (rule) return { policy, rule };
  }
  return undefined;
}

export function reasonScope(r: Reason, policies: readonly Policy[] = BUNDLED_POLICIES): "CLIP" | "CAMPAIGN" {
  if (r.basis === "MEDIA_IDENTITY" || r.basis === "TECHNICAL_OBSERVATION") return "CLIP";
  if (r.basis === "POLICY_SELECTION") return r.dimension === "policy" ? "CAMPAIGN" : "CLIP";
  if (r.ruleId === "policy-term") return "CAMPAIGN";
  const found = findRule(r.ruleId, policies);
  if (found && ASSET_BOUND_MATCH_KEYS.some((k) => found.rule.match[k] !== undefined)) return "CLIP";
  return CLIP_DIMENSIONS[r.dimension] ? "CLIP" : "CAMPAIGN";
}

/** Concrete intent changes the policy would accept, from its PERMIT rules for the failing dimensions. */
function suggestionFor(dimensions: string[], policy: Policy | undefined, intent: PublishIntent): string | undefined {
  if (!policy) {
    return intent.club
      ? `No rights policy is on file for ${intent.club} ${intent.competition} publications; ask legal to register one.`
      : "Set the publishing club on the campaign so its rights policy can be applied.";
  }
  const permits = policy.rules.filter((r) => r.effect === "PERMIT" && Object.keys(r.match).every((k) => !(ASSET_BOUND_MATCH_KEYS as readonly string[]).includes(k)));
  const union = (pick: (r: Rule) => readonly string[] | undefined) => [...new Set(permits.flatMap((r) => pick(r) ?? []))];
  const parts: string[] = [];
  if (dimensions.includes("territory")) {
    const t = union((r) => (r.dimensions.includes("territory") ? r.intent?.territories : undefined));
    if (t.length) parts.push(`Target licensed territories only: ${t.join(", ")} (not ${intent.territory}).`);
  }
  if (dimensions.includes("platform")) {
    const p = union((r) => (r.dimensions.includes("platform") ? r.intent?.platforms : undefined));
    if (p.length) parts.push(`Publish on a licensed channel: ${p.join(", ")}.`);
  }
  if (dimensions.includes("usage")) {
    const u = union((r) => (r.dimensions.includes("usage") ? r.intent?.usage : undefined)).filter((x) => x !== intent.usage);
    if (u.length) parts.push(`Use ${u.join(" or ")} instead of ${intent.usage}.`);
  }
  if (dimensions.includes("expiry")) {
    const a = policy.applicability;
    parts.push(`Schedule the publication between ${a.validFrom.slice(0, 10)} and ${a.validUntil.slice(0, 10)}.`);
  }
  if (dimensions.includes("policy")) parts.push(`Policy on file: ${policy.title}.`);
  return parts.length ? parts.join(" ") : undefined;
}

/** Classify the non-PERMIT reasons of one segment decision. */
export function classifyBlocker(decision: Decision, intent: PublishIntent, policies: readonly Policy[] = BUNDLED_POLICIES): Blocker {
  const open = decision.reasons.filter((r) => r.outcome !== "PERMIT");
  if (decision.verdict === "ALLOWED" || open.length === 0) {
    return { scope: "NONE", dimensions: [], ruleIds: [], explanation: "Nothing blocks this clip for this intent." };
  }
  const campaign = open.filter((r) => reasonScope(r, policies) === "CAMPAIGN");
  const relevant = campaign.length ? campaign : open;
  // DENY first: the hard stop is what the user must read first.
  relevant.sort((a, b) => Number(b.outcome === "DENY") - Number(a.outcome === "DENY"));
  const dimensions = [...new Set(relevant.map((r) => r.dimension))];
  const ruleIds = [...new Set(relevant.map((r) => r.ruleId))];
  const explanation = [...new Set(relevant.map((r) => r.explanation))].join(" ");
  if (campaign.length === 0) return { scope: "CLIP", dimensions, ruleIds, explanation };
  const policyId = decision.policySelection?.policyId ?? (decision.policyId === "none" ? null : decision.policyId);
  const policy = policies.find((p) => p.id === policyId);
  const suggestion = suggestionFor(dimensions, policy, intent);
  return { scope: "CAMPAIGN", dimensions, ruleIds, explanation, ...(suggestion ? { suggestion } : {}) };
}
