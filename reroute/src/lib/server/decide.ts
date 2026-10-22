import type {
  Decision,
  EditDecision,
  EditPlan,
  PublishIntent,
  Reason,
  Segment,
  Verdict,
} from "@/lib/contracts";
import { evaluateEdit, evaluateSegment, loadPolicy, type Policy } from "@/lib/rights";
import { loadDecisionContext, type AnalysisStatus, type ContextDeps, type DecisionContext } from "./context";

const SEVERITY: Record<Verdict, number> = { ALLOWED: 0, NEEDS_REVIEW: 1, BLOCKED: 2 };

function worst(verdicts: Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), "ALLOWED");
}

const ANALYSIS_DIMENSIONS = ["sponsor", "people"] as const;

/**
 * Absent video analysis means on-screen sponsors/people are unconfirmed. Adds MISSING reasons for
 * those dimensions and caps the verdict at NEEDS_REVIEW (never upgrades; BLOCKED stays BLOCKED).
 */
function withAnalysisGap(decision: Decision, segment: Segment, analysis: AnalysisStatus | undefined): Decision {
  if (analysis?.status === "AVAILABLE") return decision;
  const id = segment.scoreplayMediaId;
  const detail = analysis ? `${analysis.status}: ${analysis.detail}` : "not loaded";
  const reasons: Reason[] = ANALYSIS_DIMENSIONS.map((dimension) => ({
    ruleId: "analysis-unavailable",
    dimension,
    outcome: "MISSING",
    explanation: `No video analysis for asset ${id} (${detail}); on-screen ${dimension === "sponsor" ? "sponsors" : "people"} cannot be confirmed.`,
    scoreplayMediaId: id,
    start: segment.start,
    end: segment.end,
  }));
  return {
    ...decision,
    verdict: worst([decision.verdict, "NEEDS_REVIEW"]),
    reasons: [...decision.reasons, ...reasons],
    missingFacts: [...new Set([...decision.missingFacts, `Video analysis (sponsors/people on screen) for asset ${id}`])],
  };
}

/** Evaluate one segment with the rights engine, then apply analysis gaps. */
export function evaluateSegmentInContext(
  ctx: DecisionContext,
  segment: Segment,
  intent: PublishIntent,
  policy: Policy,
  now: Date,
): Decision {
  const id = segment.scoreplayMediaId;
  const decision = evaluateSegment({
    segment,
    asset: ctx.assets[id],
    observations: ctx.observations[id] ?? [],
    intent,
    policy,
    now,
  });
  return withAnalysisGap(decision, segment, ctx.analysis[id]);
}

/** Evaluate a whole edit (every segment) with the rights engine, then apply analysis gaps. */
export function evaluateEditInContext(
  ctx: DecisionContext,
  edit: EditPlan,
  intent: PublishIntent,
  policy: Policy,
  now: Date,
): EditDecision {
  const result = evaluateEdit({
    edit,
    assets: ctx.assets,
    observations: ctx.observations,
    intent,
    policy,
    now,
  });
  const segments = result.segments.map((sd) => ({
    segment: sd.segment,
    decision: withAnalysisGap(sd.decision, sd.segment, ctx.analysis[sd.segment.scoreplayMediaId]),
  }));
  const added = segments.flatMap((sd) => sd.decision.reasons.filter((r) => r.ruleId === "analysis-unavailable"));
  const addedFacts = segments.flatMap((sd) => sd.decision.missingFacts);
  const decision: Decision = {
    ...result.decision,
    reasons: [...result.decision.reasons, ...added],
    verdict: worst([result.decision.verdict, ...segments.map((sd) => sd.decision.verdict)]),
    missingFacts: [...new Set([...result.decision.missingFacts, ...addedFacts])],
  };
  return { edit: result.edit, decision, segments };
}

/** Fresh server-side decision for an edit: load ScorePlay + observations, evaluate, apply gaps. */
export async function decideEdit(
  edit: EditPlan,
  intent: PublishIntent,
  opts: { deps?: ContextDeps; policy?: Policy; now?: Date } = {},
): Promise<EditDecision> {
  const ctx = await loadDecisionContext(edit, opts.deps);
  return evaluateEditInContext(ctx, edit, intent, opts.policy ?? loadPolicy(), opts.now ?? new Date());
}
