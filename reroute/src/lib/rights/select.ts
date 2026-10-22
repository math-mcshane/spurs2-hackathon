/**
 * Policy selection per asset(s) + publish intent. A policy applies only when the publishing club, the
 * competition and the footage provenance all match. There is NO fallback: footage of one club is never
 * evaluated under another club's policy, and "no applicable policy" ⇒ NEEDS_REVIEW (POLICY_SELECTION).
 */
import type { Asset, PolicySelection, PublishIntent, Reason } from "@/lib/contracts";
import { sameClub } from "./club";
import type { Policy } from "./policy";
import { BUNDLED_POLICIES } from "./registry";

export interface SelectionFailure {
  /** INTENT = the publish intent is outside the policy (changing footage cannot help). */
  scope: "INTENT" | "ASSET";
  dimension: "policy" | "club" | "competition" | "provenance";
  assetId?: string;
  message: string;
}

export interface PolicyChoice {
  policy: Policy | null;
  selection: PolicySelection;
  /** policyId → why it does not apply (empty for the chosen policy). */
  failures: Record<string, SelectionFailure[]>;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Why `policy` does not govern this intent + assets (empty = applicable). */
export function applicabilityFailures(policy: Policy, intent: PublishIntent, assets: readonly Asset[]): SelectionFailure[] {
  const a = policy.applicability;
  const out: SelectionFailure[] = [];
  if (!intent.club) {
    out.push({ scope: "INTENT", dimension: "club", message: "The publish intent does not name the publishing club, so no club policy can be chosen" });
  } else if (!sameText(intent.club, a.club)) {
    out.push({ scope: "INTENT", dimension: "club", message: `${policy.title} is for club "${a.club}", but the publisher is "${intent.club}"` });
  }
  if (!a.competitions.some((c) => sameText(c, intent.competition))) {
    out.push({ scope: "INTENT", dimension: "competition", message: `${policy.title} covers ${a.competitions.join(", ")}, not ${intent.competition}` });
  }
  for (const asset of assets) {
    const teams = asset.facts.teams ?? [];
    if (!teams.some((t) => a.clubNames.some((name) => sameClub(t, name)))) {
      out.push({
        scope: "ASSET",
        dimension: "club",
        assetId: asset.id,
        message: teams.length
          ? `"${asset.title}" is tagged ${teams.join(" and ")} in ScorePlay, not ${a.clubNames[0]}`
          : `"${asset.title}" has no club tag in ScorePlay, so it cannot be shown to be ${a.clubNames[0]} footage`,
      });
    }
    const competition = asset.facts.competition;
    if (competition && !a.competitions.some((c) => sameText(c, competition))) {
      out.push({ scope: "ASSET", dimension: "competition", assetId: asset.id, message: `"${asset.title}" is ${competition} footage; ${policy.title} covers ${a.competitions.join(", ")}` });
    }
    const missingTags = (a.provenance?.requiredTags ?? []).filter((tag) => !asset.tags.some((t) => sameText(t, tag)));
    if (missingTags.length) {
      out.push({
        scope: "ASSET",
        dimension: "provenance",
        assetId: asset.id,
        message: `"${asset.title}" lacks the ScorePlay tag ${missingTags.map((t) => `"${t}"`).join(", ")} required by ${policy.title} (${a.provenance!.description})`,
      });
    }
  }
  return out;
}

/**
 * The one policy that governs every asset for this intent, or null. Among several applicable policies a
 * VERIFIED one wins over DEMO, then the lowest id (deterministic).
 */
export function selectPolicy(intent: PublishIntent, assets: readonly Asset[], policies: readonly Policy[] = BUNDLED_POLICIES): PolicyChoice {
  const failures: Record<string, SelectionFailure[]> = {};
  for (const p of policies) failures[p.id] = applicabilityFailures(p, intent, assets);
  const applicable = policies
    .filter((p) => failures[p.id].length === 0)
    .sort((x, y) => Number(x.kind === "DEMO") - Number(y.kind === "DEMO") || x.id.localeCompare(y.id));
  const policy = applicable[0] ?? null;
  return {
    policy,
    failures,
    selection: {
      policyId: policy?.id ?? null,
      kind: policy?.kind ?? null,
      considered: policies.map((p) => ({
        policyId: p.id,
        applicable: failures[p.id].length === 0,
        reason:
          failures[p.id].length === 0
            ? p === policy
              ? `Selected: ${p.title} (${p.kind}) covers ${intent.club} ${intent.competition} footage`
              : `Applicable, but ${policy!.id} takes precedence`
            : failures[p.id].map((f) => f.message).join("; "),
      })),
    },
  };
}

/** MISSING reasons for a segment of `assetId` when `choice` found no policy. */
export function noPolicyReasons(choice: PolicyChoice, intent: PublishIntent, segment: { scoreplayMediaId: string; start: number; end: number }): Reason[] {
  const base = { outcome: "MISSING" as const, basis: "POLICY_SELECTION" as const, scoreplayMediaId: segment.scoreplayMediaId, start: segment.start, end: segment.end };
  const intentFit = Object.entries(choice.failures).filter(([, f]) => f.every((x) => x.scope === "ASSET"));
  if (intentFit.length === 0) {
    const club = intent.club ? `club "${intent.club}"` : "an unnamed club";
    const why = [...new Set(Object.values(choice.failures).flatMap((f) => f.filter((x) => x.scope === "INTENT").map((x) => x.message)))];
    return [
      {
        ...base,
        ruleId: "policy-selection:none",
        dimension: "policy",
        explanation: `No rights policy covers ${intent.competition} publications by ${club}. ${why.join("; ")}.`,
      },
    ];
  }
  return intentFit.flatMap(([policyId, f]) => {
    const own = f.filter((x) => x.assetId === segment.scoreplayMediaId);
    const list = own.length ? own : f;
    return list.map((x) => ({
      ...base,
      ruleId: `policy-selection:${policyId}:${x.dimension}`,
      dimension: own.length ? x.dimension : "policy",
      explanation: own.length ? x.message : `No single policy covers every clip of this edit: ${x.message}`,
    }));
  });
}
