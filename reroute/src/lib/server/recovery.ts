import type { EditPlan, MediaRef, PublishIntent } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { BUNDLED_POLICIES, reasonScope } from "@/lib/rights";
import { evaluateUses, planRecovery, type Interval, type RecoveryPlan, type Removal, type ReplacementInput } from "@/lib/rights/recovery";
import { loadDecisionContext } from "./context";
import type { DecideOptions } from "./decide";
import { searchReplacements } from "./resolver";

export interface RecoverInput {
  /** The selected source moment (one asset) and cuts already applied to it by an earlier recovery. */
  source: { assetId: string; title: string; range: Interval; priorRemovals?: Removal[] };
  /** Every use of the campaign. */
  intents: PublishIntent[];
  /** What the moment shows (search query for replacements). */
  query: string;
  /** Replacement moments to evaluate. */
  replacements: number;
  idPrefix: string;
}

export interface Recovered {
  plan: RecoveryPlan;
  /** MediaRefs of the source asset and every replacement (audit: where the evidence came from). */
  media: MediaRef[];
  notes: string[];
}

/**
 * "Find a way to use it": loads the source asset (ScorePlay facts + every analysis run + reviewer evidence),
 * searches real replacement moments when the footage is the problem, and lets the pure planner locate, propose
 * and independently re-evaluate every option. Never assumes a change worked: each option's verdict is the
 * rights engine's own, for every use.
 */
export async function recover(input: RecoverInput, opts: DecideOptions = {}): Promise<Recovered> {
  const { source, intents } = input;
  if (intents.length === 0) throw new AppError("BAD_REQUEST", "recover needs at least one use");
  const now = opts.now ?? new Date();
  const policies = opts.policies ?? BUNDLED_POLICIES;
  const sourceEdit: EditPlan = {
    id: `${input.idPrefix}:source`,
    title: source.title,
    segments: [{ scoreplayMediaId: source.assetId, start: source.range.start, end: source.range.end, label: input.query }],
    derived: false,
  };
  const ctx = await loadDecisionContext(sourceEdit, { deps: opts.deps, club: intents.find((i) => i.club)?.club });
  const evalCtx = { assets: ctx.assets, observations: ctx.observations, analysis: ctx.analysis, policies, now };

  // Replacements only help when the footage itself is restricted for some use; a CAMPAIGN-only problem would
  const footageIssue = evaluateUses(evalCtx, sourceEdit, intents).some((u) =>
    u.decision.decision.reasons.some((r) => r.outcome !== "PERMIT" && reasonScope(r, policies) === "CLIP"),
  );
  let replacements: ReplacementInput[] = [];
  if (footageIssue && input.replacements > 0) {
    const video = ctx.video();
    if (!("status" in video)) {
      const found = await searchReplacements(ctx, { edit: sourceEdit, segmentIndex: 0, intents, query: input.query, limit: input.replacements }, { now, policies });
      replacements = found.map((c) => {
        const segment = c.proposedEdit.segments[0];
        const alone: EditPlan = { id: `${input.idPrefix}:replace:${segment.scoreplayMediaId}`, title: ctx.assets[segment.scoreplayMediaId].title, segments: [segment], derived: true };
        return {
          key: `${segment.scoreplayMediaId}@${segment.start}-${segment.end}`,
          title: ctx.assets[segment.scoreplayMediaId].title,
          segment,
          query: input.query,
          rank: c.hit.rank,
          evaluations: evaluateUses(evalCtx, alone, intents),
        };
      });
    } else ctx.notes.push(`Replacement search unavailable: ${video.detail}`);
  }

  const plan = planRecovery({ ctx: evalCtx, source, intents, replacements, idPrefix: input.idPrefix });
  return {
    plan,
    media: ctx.mediaRefs([source.assetId, ...replacements.map((r) => r.segment.scoreplayMediaId)]),
    notes: [...ctx.notes],
  };
}
