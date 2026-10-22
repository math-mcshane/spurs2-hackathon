/**
 * What stands between a segment and ALLOWED, and whether swapping the clip can help.
 * CLIP = tied to this footage (people, brands, asset tags/facts, evidence, media identity, its club/provenance).
 * CAMPAIGN = tied to the publish intent (territory, platform, usage, date, no policy for the publisher):
 * every clip fails the same way, so the fix is a different intent, not a different clip.
 * A campaign publishes one edit under several intents; the blocker aggregates all of them.
 */
import type { Blocker, Decision, PublishIntent, Reason, Usage } from "@/lib/contracts";
import { PAST_PUBLISH_RULE_ID } from "./engine";
import { ASSET_BOUND_MATCH_KEYS, type Policy, type Rule } from "./policy";
import { BUNDLED_POLICIES } from "./registry";

const CLIP_DIMENSIONS: Record<string, true> = { people: true, sponsor: true, competition: true, club: true, provenance: true, media: true };

/** The licensed subset of the requested uses (one-click fix for a CAMPAIGN blocker). */
export interface Remedy {
  territories?: string[];
  platforms?: string[];
  usage?: Usage;
}

/** One publish intent and the decision of the segment under it. */
export interface IntentDecision {
  intent: PublishIntent;
  decision: Decision;
}

const findRule = (ruleId: string, policies: readonly Policy[]): Rule | undefined =>
  policies.flatMap((p) => p.rules).find((r) => r.id === ruleId);

const isAssetBound = (rule: Rule) => ASSET_BOUND_MATCH_KEYS.some((k) => rule.match[k] !== undefined);

export function reasonScope(r: Reason, policies: readonly Policy[] = BUNDLED_POLICIES): "CLIP" | "CAMPAIGN" {
  if (r.basis === "MEDIA_IDENTITY" || r.basis === "TECHNICAL_OBSERVATION") return "CLIP";
  if (r.basis === "POLICY_SELECTION") return r.dimension === "policy" ? "CAMPAIGN" : "CLIP";
  // A rule whose applicability is uncertain because an asset fact is missing: another clip may have it.
  if (r.ruleId.startsWith("fact:")) return "CLIP";
  if (r.ruleId === "policy-term" || r.ruleId === PAST_PUBLISH_RULE_ID) return "CAMPAIGN";
  const rule = findRule(r.ruleId, policies);
  if (rule && isAssetBound(rule)) return "CLIP";
  return CLIP_DIMENSIONS[r.dimension] ? "CLIP" : "CAMPAIGN";
}

const unique = <T>(xs: readonly T[]) => [...new Set(xs)];
const list = (xs: readonly string[]) => xs.join(", ");

/** Licensed values of an intent field, from the policy's PERMIT rules that are not tied to particular footage. */
function licensed(policy: Policy, dimension: "territory" | "platform" | "usage"): string[] {
  const key = dimension === "territory" ? "territories" : dimension === "platform" ? "platforms" : "usage";
  return unique(policy.rules.filter((r) => r.effect === "PERMIT" && r.dimensions.includes(dimension) && !isAssetBound(r)).flatMap((r) => r.intent?.[key] ?? []));
}

/**
 * Classify the non-PERMIT reasons of one segment across every intent of the campaign. CAMPAIGN wins over
 * CLIP (no replacement can fix an intent problem) and lists EVERY unlicensed territory/platform/usage.
 */
export function classifyBlocker(items: readonly IntentDecision[], policies: readonly Policy[] = BUNDLED_POLICIES): { blocker: Blocker; remedy?: Remedy } {
  const open = items.flatMap(({ intent, decision }) => (decision.verdict === "ALLOWED" ? [] : decision.reasons.filter((r) => r.outcome !== "PERMIT").map((reason) => ({ intent, reason, decision }))));
  if (open.length === 0) return { blocker: { scope: "NONE", dimensions: [], ruleIds: [], explanation: "Nothing blocks this clip for these uses." } };

  const campaign = open.filter((o) => reasonScope(o.reason, policies) === "CAMPAIGN");
  if (campaign.length === 0) {
    // DENY first: the hard stop is what the user must read first.
    const sorted = [...open].sort((a, b) => Number(b.reason.outcome === "DENY") - Number(a.reason.outcome === "DENY"));
    return {
      blocker: {
        scope: "CLIP",
        dimensions: unique(sorted.map((o) => o.reason.dimension)),
        ruleIds: unique(sorted.map((o) => o.reason.ruleId)),
        explanation: unique(sorted.map((o) => o.reason.explanation)).join(" "),
      },
    };
  }

  const bad = (dimension: string, pick: (i: PublishIntent) => string) => unique(campaign.filter((o) => o.reason.dimension === dimension).map((o) => pick(o.intent)));
  const badTerritories = bad("territory", (i) => i.territory.toUpperCase());
  const badPlatforms = bad("platform", (i) => i.platform);
  const badUsages = bad("usage", (i) => i.usage);
  const policyId = campaign.map((o) => o.decision.policySelection?.policyId).find(Boolean);
  const policy = policies.find((p) => p.id === policyId);

  const sentences: string[] = [];
  if (badTerritories.length) sentences.push(`Not licensed in ${list(badTerritories)}.`);
  if (badPlatforms.length) sentences.push(`Not licensed on ${list(badPlatforms)}.`);
  if (badUsages.length) sentences.push(`${list(badUsages)} use is not licensed.`);
  for (const o of campaign) {
    const intentField = ["territory", "platform", "usage"].includes(o.reason.dimension);
    const rule = findRule(o.reason.ruleId, policies);
    sentences.push(intentField ? (rule?.explanation ?? "") : o.reason.explanation);
  }

  const suggestion: string[] = [];
  const remedy: Remedy = {};
  const requested = (pick: (i: PublishIntent) => string) => unique(items.map((i) => pick(i.intent)));
  if (!policy) {
    const club = items[0]?.intent.club;
    suggestion.push(club ? `No rights policy is on file for ${club} ${items[0].intent.competition} publications; ask legal to register one.` : "Set the publishing club on the campaign so its rights policy can be applied.");
  } else {
    if (badTerritories.length) {
      const ok = requested((i) => i.territory.toUpperCase()).filter((t) => !badTerritories.includes(t));
      remedy.territories = ok.length ? ok : licensed(policy, "territory");
      suggestion.push(`Drop ${list(badTerritories)}; licensed territories: ${list(licensed(policy, "territory"))}.`);
    }
    if (badPlatforms.length) {
      const ok = requested((i) => i.platform).filter((p) => !badPlatforms.includes(p));
      remedy.platforms = ok.length ? ok : licensed(policy, "platform");
      suggestion.push(`Drop ${list(badPlatforms)}; licensed channels: ${list(licensed(policy, "platform"))}.`);
    }
    if (badUsages.length) {
      const alternatives = licensed(policy, "usage").filter((u) => !badUsages.includes(u)) as Usage[];
      if (alternatives.length) {
        remedy.usage = alternatives[0];
        suggestion.push(`Use ${alternatives.join(" or ")} instead of ${list(badUsages)}.`);
      }
    }
    const ruleIds = campaign.map((o) => o.reason.ruleId);
    if (ruleIds.includes(PAST_PUBLISH_RULE_ID)) suggestion.push("Pick a publish date in the future.");
    if (ruleIds.includes("policy-term")) {
      const a = policy.applicability;
      suggestion.push(`Schedule the publication between ${a.validFrom.slice(0, 10)} and ${a.validUntil.slice(0, 10)}.`);
    }
  }

  return {
    blocker: {
      scope: "CAMPAIGN",
      dimensions: unique(campaign.map((o) => o.reason.dimension)),
      ruleIds: unique(campaign.map((o) => o.reason.ruleId)),
      explanation: unique(sentences.filter(Boolean)).join(" "),
      ...(suggestion.length ? { suggestion: suggestion.join(" ") } : {}),
    },
    ...(Object.keys(remedy).length ? { remedy } : {}),
  };
}
