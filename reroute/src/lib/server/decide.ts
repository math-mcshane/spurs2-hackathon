import type { Decision, EditDecision, EditPlan, MediaRef, PolicySelection, PublishIntent } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { BUNDLED_POLICIES, buildDecision, evaluateEdit, worstVerdict, type Policy } from "@/lib/rights";
import { loadDecisionContext, type ContextDeps, type DecisionContext } from "./context";

export interface DecideOptions {
  deps?: ContextDeps;
  now?: Date;
  /** Candidate policies (tests). Selection per asset + intent still applies. */
  policies?: readonly Policy[];
}

/** An edit decision plus what the receipt must record: the MediaRefs evidence came through, and degradations. */
export type DecidedEdit = EditDecision & { media: MediaRef[]; notes: string[] };

export interface CampaignDecision {
  /** Worst verdict over every intent; clearance VERIFIED only if every intent is VERIFIED. */
  overall: Decision;
  perIntent: { intent: PublishIntent; decision: EditDecision }[];
  media: MediaRef[];
  notes: string[];
}

/** Evaluate an edit whose assets are already in `ctx` (each segment under the policy selected for its asset). */
export function evaluateEditInContext(
  ctx: DecisionContext,
  edit: EditPlan,
  intent: PublishIntent,
  opts: { now: Date; policies?: readonly Policy[] },
): EditDecision {
  return evaluateEdit({
    edit,
    assets: ctx.assets,
    observations: ctx.observations,
    analysis: ctx.analysis,
    intent,
    now: opts.now,
    policies: opts.policies,
  });
}

/** Fresh server-side decision for an edit: load ScorePlay + MediaRefs + observations, select policy, evaluate. */
export async function decideEdit(edit: EditPlan, intent: PublishIntent, opts: DecideOptions = {}): Promise<DecidedEdit> {
  const ctx = await loadDecisionContext(edit, { deps: opts.deps, club: intent.club });
  const result = evaluateEditInContext(ctx, edit, intent, { now: opts.now ?? new Date(), policies: opts.policies });
  return { ...result, media: ctx.mediaRefs(edit.segments.map((s) => s.scoreplayMediaId)), notes: [...ctx.notes] };
}

function mergeSelections(selections: PolicySelection[]): PolicySelection | undefined {
  if (selections.length === 0) return undefined;
  const ids = new Set(selections.map((s) => s.policyId));
  if (ids.size === 1) return selections[0];
  return {
    policyId: null,
    kind: null,
    considered: [...new Map(selections.flatMap((s) => s.considered).map((c) => [`${c.policyId}|${c.applicable}|${c.reason}`, c])).values()],
  };
}

/** Combine per-intent decisions: worst verdict; clearance VERIFIED only if every one is VERIFIED. */
export function combineDecisions(decisions: readonly Decision[], now: Date): Decision {
  const policies = decisions.flatMap((d) =>
    d.policyId === "none"
      ? []
      : d.policyId.split("+").map((id, i) => ({
          id,
          version: d.policyVersion.split("+")[i] ?? d.policyVersion,
          kind: BUNDLED_POLICIES.find((p) => p.id === id)?.kind ?? (d.policyFictional ? ("DEMO" as const) : ("VERIFIED" as const)),
        })),
  );
  const combined = buildDecision({
    verdict: worstVerdict(decisions.map((d) => d.verdict)),
    reasons: decisions.flatMap((d) => d.reasons),
    evidence: decisions.flatMap((d) => d.evidence),
    policies,
    policySelection: mergeSelections(decisions.flatMap((d) => (d.policySelection ? [d.policySelection] : []))),
    now,
  });
  // Clearance is the weakest of the parts (an unlisted policy kind must not upgrade it).
  const clearances = decisions.map((d) => d.clearance);
  combined.clearance = clearances.includes("NONE") ? "NONE" : clearances.includes("DEMO") ? "DEMO" : combined.clearance;
  return combined;
}

/**
 * One campaign = one edit published under several intents (channels/territories). Assets and observations
 * load once; each intent is evaluated independently, then combined.
 */
export async function decideCampaign(input: { edit: EditPlan; intents: PublishIntent[] }, opts: DecideOptions = {}): Promise<CampaignDecision> {
  const { edit, intents } = input;
  if (intents.length === 0) throw new AppError("BAD_REQUEST", "decideCampaign needs at least one intent");
  const now = opts.now ?? new Date();
  const ctx = await loadDecisionContext(edit, { deps: opts.deps, club: intents.find((i) => i.club)?.club });
  const perIntent = intents.map((intent) => ({ intent, decision: evaluateEditInContext(ctx, edit, intent, { now, policies: opts.policies }) }));
  return {
    overall: combineDecisions(perIntent.map((p) => p.decision.decision), now),
    perIntent,
    media: ctx.mediaRefs(edit.segments.map((s) => s.scoreplayMediaId)),
    notes: [...ctx.notes],
  };
}
