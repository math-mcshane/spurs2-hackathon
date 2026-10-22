import { randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  isEvidenceLinkable,
  type Decision,
  type EditDecision,
  type EditPlan,
  type MediaRef,
  type PublishIntent,
  type ResolveRequestSchema,
  type ResolveResponseSchema,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getMediaResolver } from "@/lib/media";
import { decideCampaign } from "@/lib/server/decide";
import { alternatives, campaigns, evaluations, events, goalRuns } from "@/lib/server/repositories";
import { resolve } from "@/lib/server/resolver";
import { createReceipt, getReceipt } from "@/lib/server/store";
import { CLUBS } from "../clubs";
import { configuredDestination, onClubDomain } from "../commerce";
import { buildGoalCampaign, editFor } from "../goal-campaign";
import { goalPlan, parseMatch } from "../goal-intents";
import { buildGoalView, latestEvaluation } from "../goal-view";
import { clock } from "../moment-ranking";
import { PRODUCTS, parseObjective } from "../objective-parser";
import type {
  AlternativeCandidate,
  Club,
  CommerceDestination,
  GoalAlternatives,
  GoalCampaign,
  GoalEvaluation,
  GoalRun,
  GoalView,
  Recommendation,
} from "../types";
import { searchGoal, type GoalSearch } from "./goal-search";

/**
 * The product flow: goal → three real moments → campaign proposal → REROUTE evaluation of every
 * channel × territory → "Find another way" (REROUTE resolver) → independent re-check → human review
 * receipt. Rights are only ever REROUTE's; publication is only ever `canPublish()` on the receipt.
 * Every campaign version, evaluation, alternative search and submission is persisted and audited.
 */

export type CampaignDecision = { overall: Decision; perIntent: { intent: PublishIntent; decision: EditDecision }[] };
type ResolveInput = z.input<typeof ResolveRequestSchema>;
type Resolved = z.output<typeof ResolveResponseSchema>;

/** External calls (live services); persistence goes through the repositories. */
export type GoalDeps = {
  search(input: { club: Club; objective: GoalRun["objective"]; match?: string }): Promise<GoalSearch>;
  decideCampaign(input: { edit: EditPlan; intents: PublishIntent[] }): Promise<CampaignDecision>;
  resolve(input: ResolveInput & { limit: number }): Promise<Resolved>;
  resolveMedia(scoreplayMediaId: string, club: Club): Promise<MediaRef>;
  now(): Date;
};

const defaultDeps: GoalDeps = {
  search: (input) => searchGoal(input),
  decideCampaign: (input) => decideCampaign(input),
  resolve: (input) => resolve(input),
  resolveMedia: (id, club) => getMediaResolver(club).forScoreplay(id),
  now: () => new Date(),
};

/** The Studio has no producer login (reviewers sign in for review); actions are attributed to the Studio. */
const ACTOR = "pulse-studio";
/** Replacements REROUTE's resolver evaluates per "Find another way". */
const ALTERNATIVES = 3;

async function present(run: GoalRun): Promise<GoalView> {
  const receipt = run.review ? await getReceipt(run.review.receiptId) : null;
  return buildGoalView(run, receipt);
}

const allMoments = (run: GoalRun) => [...run.pool, ...run.adopted];

function currentCampaign(run: GoalRun): GoalCampaign {
  if (!run.campaign) throw new AppError("BAD_REQUEST", "Pick a moment to build its campaign first.");
  return run.campaign;
}

function momentOf(run: GoalRun, key: string): Recommendation {
  const rec = allMoments(run).find((r) => r.key === key);
  if (!rec) throw new AppError("BAD_REQUEST", "That moment is not one of this goal's results");
  return rec;
}

/** First per-use decision with the overall (worst) verdict: the use REROUTE's resolver works on. */
function blockingUse(e: GoalEvaluation) {
  return e.perIntent.find((p) => p.decision.verdict === e.overall.verdict) ?? e.perIntent[0];
}

/** Builds, versions (campaigns repo) and audits a campaign for `rec`; returns the stored version. */
async function newVersion(
  run: GoalRun,
  rec: Recommendation,
  origin: GoalCampaign["origin"],
  now: Date,
  destination?: CommerceDestination,
): Promise<GoalCampaign> {
  const previous = run.campaign;
  const campaignId = previous?.campaignId ?? randomUUID();
  const product = run.objective.product?.key;
  const kind = product && PRODUCTS[product].commerce;
  const kept = previous?.cta.destination?.source === "PRODUCER_ENTERED" ? previous.cta.destination : undefined;
  const dest = product && kind ? (destination ?? kept ?? configuredDestination(run.club, product, kind, run.objective.market?.code)) : undefined;
  const draft = buildGoalCampaign({ run, rec, campaignId, version: (previous?.version ?? 0) + 1, origin, destination: dest, now, previous });
  const version = await campaigns.saveVersion(campaignId, draft, ACTOR, { goalRunId: run.id });
  await events.append({ subjectType: "campaign", subjectId: campaignId, type: "CAMPAIGN_VERSION_SAVED", actor: ACTOR, payload: { goalRunId: run.id, version, origin, key: rec.key } });
  return { ...draft, version };
}

/** Asks REROUTE about every channel × territory of the campaign and records each decision. */
async function evaluate(run: GoalRun, campaign: GoalCampaign, kind: GoalEvaluation["kind"], deps: GoalDeps): Promise<GoalEvaluation> {
  const edit = editFor(run.id, momentOf(run, campaign.key));
  const result = await deps.decideCampaign({ edit, intents: campaign.intents });
  const perIntent = result.perIntent.map((p) => ({ intent: p.intent, decision: p.decision.decision }));
  const records = await Promise.all(
    perIntent.map((p) =>
      evaluations.record({ campaignId: campaign.campaignId, campaignVersion: campaign.version, kind, media: [campaign.mediaRef], intent: p.intent, decision: p.decision }),
    ),
  );
  // The evaluation is identified by the record of the use REROUTE's resolver will work on (the worst one).
  const worst = Math.max(0, perIntent.findIndex((p) => p.decision.verdict === result.overall.verdict));
  const evaluation: GoalEvaluation = {
    id: records[worst].id,
    kind,
    campaignId: campaign.campaignId,
    campaignVersion: campaign.version,
    key: campaign.key,
    media: campaign.mediaRef,
    edit,
    overall: result.overall,
    perIntent,
    evaluatedAt: result.overall.evaluatedAt,
  };
  await campaigns.setState(campaign.campaignId, { status: `RIGHTS_${result.overall.verdict}` });
  await events.append({
    subjectType: "campaign",
    subjectId: campaign.campaignId,
    type: kind === "ORIGINAL" ? "RIGHTS_EVALUATED" : "ALTERNATIVE_RECHECKED",
    actor: ACTOR,
    payload: {
      goalRunId: run.id,
      version: campaign.version,
      verdict: result.overall.verdict,
      clearance: result.overall.clearance,
      evaluationIds: records.map((r) => r.id),
      uses: perIntent.map((p) => `${p.intent.platform}/${p.intent.territory}:${p.decision.verdict}`),
    },
  });
  return evaluation;
}

export async function runGoal(goal: string, club: Club, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const submittedAt = deps.now();
  const objective = parseObjective(goal, submittedAt);
  if (objective.club && objective.club !== club) {
    throw new AppError(
      "BAD_REQUEST",
      `This goal names ${CLUBS[objective.club].label}, but the selected club is ${CLUBS[club].label}. Select ${CLUBS[objective.club].label} or rephrase the goal.`,
    );
  }
  if (!objective.market && !objective.product && objective.scope !== "GLOBAL") {
    throw new AppError(
      "BAD_REQUEST",
      "PULSE could not tell what this goal should achieve or for whom. Try: “Promote Tottenham merchandise to UK supporters”.",
    );
  }
  const match = parseMatch(goal);
  const found = await deps.search({ club, objective, match });
  const run: GoalRun = {
    id: `goal-${randomUUID().slice(0, 8)}`,
    schemaVersion: 2,
    club,
    submittedAt: submittedAt.toISOString(),
    resultsAt: deps.now().toISOString(),
    objective,
    plan: goalPlan(objective, club),
    match,
    ...found,
    adopted: [],
    evaluations: [],
    alternatives: [],
  };
  await goalRuns.create(run);
  await events.append({
    subjectType: "goal",
    subjectId: run.id,
    type: "GOAL_RUN",
    actor: ACTOR,
    payload: { goal, club, plan: run.plan, match: run.matchFilter ?? match, search: run.search.status, moments: run.pool.slice(0, 3).map((r) => r.key) },
  });

  // The proposal for the best moment is built right away, so time-to-proposal excludes user think-time.
  const top = run.pool[0];
  if (!top) return present(run);
  const campaign = await newVersion(run, top, "PROPOSAL", deps.now());
  const saved = await goalRuns.update(run.id, (r) => {
    r.campaign = campaign;
    r.selectedKey = top.key;
    r.proposalAt = campaign.createdAt;
  });
  return present(saved);
}

/** One goal run, or the latest when no id is given (null before the first goal). */
export async function getGoal(id?: string): Promise<GoalView | null> {
  const run = id ? await goalRuns.get(id) : await goalRuns.latest();
  return run ? present(run) : null;
}

/** Switches the proposal to another of the goal's moments (new campaign version). */
export async function selectMoment(id: string, key: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await goalRuns.get(id);
  const rec = momentOf(run, key);
  if (run.campaign?.key === key) return present(run);
  const campaign = await newVersion(run, rec, "SELECTED", deps.now());
  const saved = await goalRuns.update(id, (r) => {
    r.campaign = campaign;
    r.selectedKey = key;
    r.proposalAt ??= campaign.createdAt;
  });
  return present(saved);
}

/** Updates the proposal's details — today the commerce destination (https, on the club's domain). */
export async function draftGoalCampaign(id: string, commerceUrl: string | undefined, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await goalRuns.get(id);
  const current = currentCampaign(run);
  const product = run.objective.product?.key;
  const kind = product && PRODUCTS[product].commerce;
  if (commerceUrl && !kind) throw new AppError("BAD_REQUEST", "This goal has no store or ticketing destination.");
  if (commerceUrl && !onClubDomain(run.club, commerceUrl)) {
    throw new AppError("BAD_REQUEST", `The link must be https on the club's own domain (${CLUBS[run.club].domains.join(", ")}).`);
  }
  const destination: CommerceDestination | undefined = commerceUrl && kind ? { kind, url: commerceUrl, source: "PRODUCER_ENTERED" } : undefined;
  const campaign = await newVersion(run, momentOf(run, current.key), "DESTINATION", deps.now(), destination);
  const saved = await goalRuns.update(id, (r) => {
    r.campaign = campaign;
  });
  return present(saved);
}

/** Sends the current campaign version, exactly as proposed, through REROUTE for every channel × territory. */
export async function checkGoalRights(id: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await goalRuns.get(id);
  const campaign = currentCampaign(run);
  const evaluation = await evaluate(run, campaign, campaign.origin === "ALTERNATIVE" ? "ALTERNATIVE" : "ORIGINAL", deps);
  const saved = await goalRuns.update(id, (r) => {
    r.evaluations.push(evaluation);
  });
  return present(saved);
}

/**
 * "Find another way": REROUTE's resolver classifies the restriction and, when it is tied to the clip,
 * searches comparable footage and checks each candidate alone and as the full edit. A CAMPAIGN-scoped
 * blocker (territory/platform/usage/date) is reported with its suggestion — no replacement clips, and
 * the search is never repeated for the same evaluation.
 */
export async function findAlternatives(id: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await goalRuns.get(id);
  const latest = latestEvaluation(run);
  if (!latest || latest.campaignVersion !== run.campaign?.version) throw new AppError("BAD_REQUEST", "Check rights with REROUTE for this version first.");
  if (latest.overall.verdict === "ALLOWED") throw new AppError("BAD_REQUEST", "REROUTE allowed every proposed use; there is nothing to route around.");
  if (run.alternatives.some((a) => a.forEvaluationId === latest.id)) return present(run);

  const rec = momentOf(run, latest.key);
  const use = blockingUse(latest);
  const result = await deps.resolve({ edit: latest.edit, intent: use.intent, segmentIndex: 0, query: rec.matches[0]?.query, limit: ALTERNATIVES });
  const candidates: AlternativeCandidate[] =
    result.blocker.scope === "CAMPAIGN"
      ? []
      : result.candidates.map((c) => {
          const seg = c.proposedEdit.segments[0];
          return {
            key: `${seg.scoreplayMediaId}@${seg.start}-${seg.end}`,
            hit: c.hit,
            segment: seg,
            verdict: c.editDecision.decision.verdict,
            clearance: c.editDecision.decision.clearance,
            eligible: c.eligible,
            reasons: c.editDecision.decision.reasons.filter((r) => r.outcome !== "PERMIT").map(({ dimension, outcome, explanation }) => ({ dimension, outcome, explanation })),
          };
        });
  const record = await alternatives.record({ evaluationId: latest.id, blocker: result.blocker, candidates });
  const found: GoalAlternatives = {
    id: record.id,
    forKey: latest.key,
    forEvaluationId: latest.id,
    requestedAt: deps.now().toISOString(),
    intent: use.intent,
    query: result.query,
    blocker: result.blocker,
    candidates,
  };
  await events.append({
    subjectType: "campaign",
    subjectId: latest.campaignId,
    type: "ALTERNATIVES_SEARCHED",
    actor: ACTOR,
    payload: { goalRunId: run.id, evaluationId: latest.id, blocker: result.blocker.scope, candidates: candidates.map((c) => `${c.key}:${c.verdict}`) },
  });
  const saved = await goalRuns.update(id, (r) => {
    r.alternatives.push(found);
  });
  return present(saved);
}

/** A resolver candidate as a goal moment (its MediaRef re-resolved server-side, never trusted from the hit). */
function adoptedMoment(run: GoalRun, from: GoalAlternatives, c: AlternativeCandidate, media: MediaRef): Recommendation {
  const original = momentOf(run, from.forKey);
  const { start, end } = c.segment;
  const title = media.match?.scoreplayFilename ?? `ScorePlay asset ${c.segment.scoreplayMediaId}`;
  const seconds = Math.round(end - start);
  return {
    key: c.key,
    candidate: {
      scoreplayAssetId: c.segment.scoreplayMediaId,
      twelveLabsVideoId: media.twelvelabsVideoId,
      title,
      kind: "video",
      thumbnailUrl: c.hit.thumbnailUrl,
      durationSec: media.match?.scoreplayDurationSec,
      startSeconds: start,
      endSeconds: end,
      competition: original.candidate.competition,
      foundBy: "TWELVELABS",
      discoveredBy: "INDEX_SEARCH",
      rank: c.hit.rank,
      query: from.query,
      origin: c.hit.origin,
      mapping: { via: media.method as "AUTHORITATIVE_ID" | "FILENAME_DURATION", filename: media.match?.twelvelabsFilename ?? title },
    },
    media,
    headline: `${original.headline} (alternative)`,
    score: 0,
    breakdown: {
      relevance: 0,
      readiness: 0,
      contextFactor: 1,
      notes: {
        relevance: `Found by REROUTE's resolver: #${c.hit.rank} for “${from.query}”.`,
        readiness: "Cut to the same length as the restricted moment.",
        context: `Replaces ${from.forKey}.`,
      },
    },
    matches: [{ ...original.matches[0], query: from.query, rank: c.hit.rank, start: c.hit.start, end: c.hit.end }],
    why: {
      opportunity: original.why.opportunity,
      media: `REROUTE found this ${seconds}-second moment at ${clock(start)}–${clock(end)} in “${title}” as comparable footage, and checked it independently.`,
      action: original.why.action,
    },
    duplicates: [],
    previewNote: `To watch it, open ScorePlay asset ${c.segment.scoreplayMediaId} at ${clock(start)}–${clock(end)}.`,
  };
}

/** Swaps an alternative into a NEW campaign version and re-evaluates every use independently. */
export async function useAlternative(id: string, key: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await goalRuns.get(id);
  const from = run.alternatives.findLast((a) => a.candidates.some((c) => c.key === key));
  const candidate = from?.candidates.find((c) => c.key === key);
  if (!from || !candidate) throw new AppError("BAD_REQUEST", "That alternative is not one REROUTE proposed for this goal.");
  if (candidate.verdict === "BLOCKED") throw new AppError("BAD_REQUEST", "REROUTE blocked this alternative too; pick another one.");
  const media = await deps.resolveMedia(candidate.segment.scoreplayMediaId, run.club);
  if (!isEvidenceLinkable(media)) {
    throw new AppError("BAD_REQUEST", `ScorePlay asset ${candidate.segment.scoreplayMediaId} has no unique TwelveLabs link (${media.method}); it cannot be used.`);
  }
  const rec = adoptedMoment(run, from, candidate, media);
  const withMoment: GoalRun = { ...run, adopted: [...run.adopted.filter((r) => r.key !== rec.key), rec] };
  const campaign = await newVersion(withMoment, rec, "ALTERNATIVE", deps.now());
  const evaluation = await evaluate(withMoment, campaign, "ALTERNATIVE", deps);
  const saved = await goalRuns.update(id, (r) => {
    r.adopted = [...r.adopted.filter((x) => x.key !== rec.key), rec];
    r.campaign = campaign;
    r.selectedKey = rec.key;
    r.evaluations.push(evaluation);
  });
  return present(saved);
}

/**
 * Sends the current version to human review: allowed for ALLOWED (any clearance) or NEEDS_REVIEW,
 * never BLOCKED. Creates the REROUTE audit receipt; the review itself is POST /api/receipts/[id]/review.
 */
export async function submitForReview(id: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await goalRuns.get(id);
  const campaign = currentCampaign(run);
  const latest = latestEvaluation(run);
  if (!latest || latest.campaignVersion !== campaign.version) throw new AppError("BAD_REQUEST", "Check rights with REROUTE for this version first.");
  if (latest.overall.verdict === "BLOCKED") throw new AppError("BAD_REQUEST", "REROUTE blocked this campaign; a blocked campaign cannot be submitted. Find another way first.");
  if (run.review?.campaignVersion === campaign.version) return present(run);

  const use = blockingUse(latest);
  const receipt = await createReceipt({ edit: latest.edit, intent: use.intent, decision: latest.overall, campaignId: campaign.campaignId, media: [latest.media] });
  // createReceipt({campaignId}) links the receipt and sets the campaign's review status to PENDING.
  await campaigns.setState(campaign.campaignId, { status: "IN_REVIEW" });
  await events.append({
    subjectType: "campaign",
    subjectId: campaign.campaignId,
    type: "SUBMITTED_FOR_REVIEW",
    actor: ACTOR,
    payload: { goalRunId: run.id, version: campaign.version, receiptId: receipt.id, evaluationId: latest.id, verdict: latest.overall.verdict, clearance: latest.overall.clearance },
  });
  const saved = await goalRuns.update(id, (r) => {
    r.review = { receiptId: receipt.id, submittedAt: deps.now().toISOString(), campaignVersion: campaign.version, evaluationId: latest.id };
  });
  return buildGoalView(saved, receipt);
}
