import type { Evidence, Reason } from "@/lib/contracts";
import { reasonScope } from "@/lib/rights";
import { isUnverifiedPerson, normalizeLabel } from "@/lib/rights/engine";
import { events, goalRuns } from "@/lib/server/repositories";
import { campaignEdit, editFor, intentsFor, proposedPublishAt } from "../goal-campaign";
import { isDemo, plannedUsesLabel, preflightBasis, reasonFinding, reasonTopic, subjectName, unverifiedPeopleText } from "../goal-view";
import { OpportunityPreflightSchema, type OpportunityPreflight, type PreflightFinding } from "../types";
import { licenceGapOf, momentOf, runPolicies, type GoalDeps } from "./goal-service";

/**
 * Selection-time rights preflight of one recommended moment (Opportunity Studio): the SAME engine call as
 * "Check rights" (`deps.decideCampaign`, same inputs as `evaluate()` in goal-service) for the run's current plan
 * and rule package, but read-only on the run — nothing is recorded as the campaign's evaluation and the run
 * version never moves (a write would break the optimistic concurrency of the user's actions). An early read of
 * REROUTE's verdict, never a clearance; only an audit event is appended.
 */

const ACTOR = "pulse-studio";
/** Findings a card shows (DENY first). */
const MAX_FINDINGS = 4;

/**
 * A per-subject reason ("subject:person:porro") is backed by that subject's own observation when there is one (as the
 * recovery planner locates it), not by whichever person happened to be seen in the same window.
 */
function evidenceFor(r: Reason, evidence: readonly Evidence[]): readonly Evidence[] {
  if (!r.ruleId.startsWith("subject:")) return evidence;
  const label = r.ruleId.slice("subject:".length);
  const own = evidence.filter((e) => e.label && normalizeLabel(e.label) === label);
  return own.length ? own : evidence;
}

export async function preflightOpportunity(input: { id: string; key: string }, deps: GoalDeps): Promise<OpportunityPreflight> {
  const { run } = await goalRuns.getVersioned(input.id);
  const rec = momentOf(run, input.key);
  const basis = preflightBasis(run, rec);
  const plan = run.campaign?.plan ?? run.plan;
  const edl = run.campaign?.key === rec.key ? run.campaign.edl : undefined;
  const edit = run.campaign?.key === rec.key ? campaignEdit(run.id, rec, edl) : editFor(run.id, rec);
  const intents = intentsFor(plan, rec, proposedPublishAt(deps.now()));
  const { policies, context } = await runPolicies(run, deps);
  const result = await deps.decideCampaign({ edit, intents, policies });

  const perIntent = result.perIntent.map((p) => ({ intent: p.intent, decision: p.decision.decision }));
  const { overall } = result;
  const allowed = overall.verdict === "ALLOWED";
  const plannedUses = plannedUsesLabel(perIntent.map((p) => p.intent));

  const open = perIntent.flatMap((p) => p.decision.reasons.filter((r) => r.outcome !== "PERMIT").map((r) => ({ r, p })));
  const scopes = new Set(open.map(({ r }) => reasonScope(r, policies)));
  const scope = allowed ? undefined : scopes.size === 0 || (scopes.size === 1 && scopes.has("CLIP")) ? "CLIP" : scopes.size === 1 ? "CAMPAIGN" : "MIXED";

  const territories = [...new Set(perIntent.map((p) => p.intent.territory))];
  const blockedTerritories = territories.filter((t) => !perIntent.some((p) => p.intent.territory === t && p.decision.verdict === "ALLOWED"));

  // One finding per (what was found, rule), across every use it applies to. People named only by AI that ScorePlay
  // can't confirm share ONE finding ("4 people named by AI couldn't be verified…").
  const byKey = new Map<string, PreflightFinding>();
  const unverified = open.filter(({ r }) => isUnverifiedPerson(r));
  const people = [...new Set(unverified.map(({ r }) => r.ruleId))];
  for (const { r, p } of open) {
    if (people.length > 1 && isUnverifiedPerson(r)) continue;
    const f = reasonFinding(r, { evidence: evidenceFor(r, p.decision.evidence), fictional: p.decision.policyFictional, plannedUse: plannedUses, sponsorship: p.decision.sponsorship });
    if (!f) continue;
    const found = f.found[0];
    const key = JSON.stringify([found.text, r.ruleId]);
    const prev = byKey.get(key);
    if (prev) {
      if (r.outcome === "DENY") prev.outcome = "DENY";
      if (!prev.territories.includes(p.intent.territory)) prev.territories.push(p.intent.territory);
      continue;
    }
    byKey.set(key, {
      topic: reasonTopic(r.dimension),
      outcome: f.outcome,
      found: found.text,
      source: found.source,
      ...(r.start !== undefined && r.end !== undefined && r.start >= 0 && r.end >= 0 ? { at: { start: r.start, end: r.end } } : {}),
      ...(r.ruleId ? { ruleId: r.ruleId } : {}),
      rule: r.explanation,
      territories: [p.intent.territory],
    });
  }
  if (people.length > 1) {
    const evidence = unverified.flatMap(({ p }) => p.decision.evidence);
    const names = people.map((ruleId) => subjectName({ ruleId }, evidence));
    byKey.set("identity:unverified-people", {
      topic: reasonTopic("people"),
      outcome: "MISSING",
      found: `AI named ${names.join(", ")}`,
      source: "Video analysis · TwelveLabs",
      ruleId: "identity:unverified-people",
      rule: unverifiedPeopleText(names),
      territories: [...new Set(unverified.map(({ p }) => p.intent.territory))],
    });
  }
  const findings = [...byKey.values()].sort((a, b) => Number(b.outcome === "DENY") - Number(a.outcome === "DENY")).slice(0, MAX_FINDINGS);

  const gap = licenceGapOf(perIntent, policies);
  const preflight = OpportunityPreflightSchema.parse({
    key: rec.key,
    basis,
    verdict: overall.verdict,
    clearance: overall.clearance,
    illustrative: isDemo(overall) || perIntent.some((p) => isDemo(p.decision)),
    allowedUses: perIntent.filter((p) => p.decision.verdict === "ALLOWED").length,
    totalUses: perIntent.length,
    plannedUses,
    segments: edit.segments.map((s) => ({ scoreplayMediaId: s.scoreplayMediaId, start: s.start, end: s.end })),
    edited: !!edl,
    ...(scope ? { scope } : {}),
    blockedTerritories,
    ...(gap ? { licenceGap: gap } : {}),
    findings,
    ...(context ? { policy: context } : {}),
    evaluatedAt: overall.evaluatedAt,
  } satisfies OpportunityPreflight);

  await events.append({
    subjectType: "goal",
    subjectId: run.id,
    type: "PREFLIGHT_CHECKED",
    actor: ACTOR,
    payload: {
      key: rec.key,
      basis,
      verdict: overall.verdict,
      clearance: overall.clearance,
      policy: context ? { id: context.packageId, version: context.version, sourceType: context.sourceType, verified: context.verified } : null,
      edit: { id: edit.id, derived: edit.derived, segments: edit.segments.map((s) => [s.scoreplayMediaId, s.start, s.end]) },
      uses: perIntent.map((p) => `${p.intent.platform}/${p.intent.territory}/${p.intent.usage}:${p.decision.verdict}`),
    },
  });
  return preflight;
}
