import type { MediaRef, Reason } from "@/lib/contracts";
import type { PlannedOption, ProblemItem, RecoveryPlan } from "@/lib/rights/recovery";
import { evidenceSource, recoveryOptionView } from "@/features/pulse/goal-view";
import type { RecoveryView, SourcedLine, StoredRecoveryOption } from "@/features/pulse/types";

/**
 * Presentation of a Media Compliance Recovery plan, shared by the PULSE goal flow (stored on the run) and the
 * advanced rights desk (`POST /api/recover`, not stored): where every fact and rule came from, and each planned
 * option with the engine's own independent re-check. Pure mapping — never changes an outcome.
 */

/** Where a reason's fact or rule comes from, for the user. */
export function reasonSource(r: Reason, policyTitle: string): string {
  if (r.basis === "TECHNICAL_OBSERVATION") return "TwelveLabs video analysis";
  if (r.basis === "MEDIA_IDENTITY") return "ScorePlay ↔ TwelveLabs link";
  if (r.basis === "POLICY_SELECTION") return "Policy selection";
  if (r.ruleId.startsWith("subject:")) return "ScorePlay squad list + TwelveLabs video analysis";
  return `${policyTitle} · rule ${r.ruleId}`;
}

export function problemLine(p: ProblemItem, policyTitle: string): SourcedLine {
  const sources = [...new Set(p.evidence.map(evidenceSource))];
  const source = sources.length ? sources.join(" + ") : p.scope === "CAMPAIGN" ? "Your campaign plan" : `${policyTitle} · ${p.ruleIds.join(", ")}`;
  return { text: p.text, source, ...(p.at ? { at: p.at } : {}) };
}

/** A planned option as stored on a goal run (view fields + what applying it needs). */
export function storedOption(o: PlannedOption, recommendedId: string | undefined, media: readonly MediaRef[], policyTitle: string): StoredRecoveryOption {
  return {
    id: o.id,
    kind: o.kind,
    title: o.title,
    summary: o.summary,
    tradeoff: o.tradeoff,
    changesGoal: o.changesGoal,
    outcome: o.outcome,
    ...(o.notViableBecause ? { notViableBecause: o.notViableBecause } : {}),
    ...(o.recheck
      ? {
          recheck: {
            verdict: o.recheck.verdict,
            clearance: o.recheck.clearance,
            allowedUses: o.recheck.allowedUses,
            totalUses: o.recheck.totalUses,
            remaining: o.recheck.remaining.map((r) => ({
              text: r.explanation,
              source: reasonSource(r, policyTitle),
              ...(r.start !== undefined && r.end !== undefined ? { at: { start: r.start, end: r.end } } : {}),
            })),
            policyId: o.recheck.policyId,
            policyVersion: o.recheck.policyVersion,
            evaluatedAt: o.recheck.evaluatedAt,
          },
        }
      : {}),
    ...(o.replacement ? { replacement: o.replacement } : {}),
    ...(o.campaignChange ? { campaignChange: o.campaignChange } : {}),
    ...(o.relevance ? { relevance: o.relevance } : {}),
    recommended: o.id === recommendedId,
    applicable: o.outcome === "RESOLVES_DEMO" || o.outcome === "NEEDS_REVIEW",
    ...(o.edl ? { edl: o.edl } : {}),
    ...(o.intents ? { intents: o.intents } : {}),
    ...(o.edit && o.kind === "REPLACE" ? { segment: o.edit.segments[0] } : {}),
    ...(o.replacement ? { media: media.find((m) => m.scoreplayMediaId === o.replacement!.scoreplayMediaId) } : {}),
  };
}

/**
 * A plan that is shown but not stored (the desk): the same view the Compliance Editor renders for a goal run.
 * `forEvaluationId` names what the plan was computed for (the desk's edit id: no evaluation is persisted).
 */
export function recoveryViewOf(
  plan: RecoveryPlan,
  opts: { id: string; forEvaluationId: string; generatedAt: string; media: readonly MediaRef[]; policyTitle: string; assetDurationSec?: number },
): RecoveryView {
  return {
    id: opts.id,
    forEvaluationId: opts.forEvaluationId,
    generatedAt: opts.generatedAt,
    scope: plan.scope,
    problem: { headline: plan.headline, items: plan.problems.map((p) => problemLine(p, opts.policyTitle)) },
    options: plan.options.map((o) => recoveryOptionView(storedOption(o, plan.recommendedId, opts.media, opts.policyTitle), opts.assetDurationSec)),
    ...(plan.recommendedId ? { recommendedId: plan.recommendedId } : {}),
    ...(plan.noPathMessage ? { noPathMessage: plan.noPathMessage } : {}),
  };
}
