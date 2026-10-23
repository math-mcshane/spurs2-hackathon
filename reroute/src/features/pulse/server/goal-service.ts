import { randomUUID } from "node:crypto";
import { isEvidenceLinkable, type EditPlan, type MediaRef, type PublishIntent, type Reason } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getMediaResolver, previewFor } from "@/lib/media";
import { forMediaAccess, type MediaAccess } from "@/lib/media/preview";
import { mergeProvenance, trackProvenance } from "@/lib/media/provenance";
import { reasonScope, type Policy } from "@/lib/rights";
import { policiesForEvaluation, toPolicyContext } from "@/lib/rights/packages";
import { decideCampaign, type CampaignDecision } from "@/lib/server/decide";
import { recover, type Recovered, type RecoverInput } from "@/lib/server/recovery";
import { problemLine, storedOption } from "@/lib/server/recovery-view";
import { alternatives, campaigns, evaluations, events, goalRuns } from "@/lib/server/repositories";
import { createReceipt, getReceipt } from "@/lib/server/store";
import { CLUBS } from "../clubs";
import { MEDIA_PREVIEW_DISABLED_NOTE, MEDIA_PREVIEW_REVIEWER_ONLY_NOTE } from "../flags";
import { configuredDestination, onClubDomain } from "../commerce";
import { buildGoalCampaign, campaignEdit, proposedPublishAt } from "../goal-campaign";
import { goalPlan, parseMatch } from "../goal-intents";
import { buildGoalView, latestEvaluation, noLicenceReason, underRunPolicy } from "../goal-view";
import { clock } from "../moment-ranking";
import { PRODUCTS, parseObjective } from "../objective-parser";
import type {
  Club,
  CommerceDestination,
  GoalCampaign,
  GoalEvaluation,
  GoalPlan,
  GoalRecovery,
  GoalRun,
  GoalView,
  PolicyContext,
  Preview,
  Recommendation,
  RunProvenance,
  StoredRecoveryOption,
} from "../types";
import { RecoveryOptionSchema } from "../types";
import { searchGoal, type GoalSearch } from "./goal-search";
import { suggestPhotos, type PhotoInput, type PhotoResult } from "./photo-suggestions";

/**
 * The product flow: goal → three real moments → campaign proposal → REROUTE evaluation of every
 * channel × territory under the run's rule package → "Find a way to use it" (Media Compliance Recovery
 * Engine: locate, propose, independently re-check) → apply an option (new campaign version, re-evaluated) →
 * human review receipt. Rights are only ever REROUTE's; publication is only ever `canPublish()` on the
 * receipt. Every version, evaluation, recovery plan and submission is persisted and audited.
 * Every action on an existing run carries the run version the user saw (optimistic concurrency).
 */

/** The rule package a run is evaluated against: the policies the engine may select from + its identity. */
export type RunPolicies = { policies: Policy[]; context?: PolicyContext };

/** External calls (live services); persistence goes through the repositories. */
export type GoalDeps = {
  search(input: { club: Club; objective: GoalRun["objective"]; match?: string }): Promise<GoalSearch>;
  decideCampaign(input: { edit: EditPlan; intents: PublishIntent[]; policies: Policy[] }): Promise<CampaignDecision>;
  recover(input: RecoverInput & { policies: Policy[] }): Promise<Recovered>;
  /** Exactly one package for `club` (the requested one, else the club's default) + other clubs' defaults. */
  policies(club: Club, packageId?: string): Promise<RunPolicies>;
  resolveMedia(scoreplayMediaId: string, club: Club): Promise<MediaRef>;
  /** Playable reference for a linked video, resolved per request (never stored). */
  preview(ref: MediaRef, club: Club): Promise<Preview | undefined>;
  /** The caller's right to footage-derived URLs (previews AND thumbnails); anything but ALLOWED strips them all. */
  media: MediaAccess;
  /** Club-library photos for the goal (ScorePlay metadata only, REROUTE-checked); omitted = no photo suggestions. Never rejects. */
  photos?(input: PhotoInput): Promise<PhotoResult>;
  now(): Date;
};

const defaultDeps: GoalDeps = {
  search: (input) => searchGoal(input),
  decideCampaign: ({ policies, ...input }) => decideCampaign(input, { policies }),
  recover: ({ policies, ...input }) => recover(input, { policies }),
  policies: async (club, packageId) => {
    const { policies, package: pkg } = await policiesForEvaluation({ club, packageId });
    return { policies, ...(pkg ? { context: toPolicyContext(pkg) } : {}) };
  },
  resolveMedia: (id, club) => getMediaResolver(club).forScoreplay(id),
  preview: (ref, club) => previewFor(ref, { club }),
  photos: (input) => suggestPhotos(input),
  media: "DISABLED",
  now: () => new Date(),
};

/** Live deps for one request; `media` comes from `mediaAccess(req)` (lib/media/preview). */
export const goalDeps = (media: MediaAccess): GoalDeps => ({ ...defaultDeps, media });

const UNAVAILABLE_NOTE: Record<Exclude<MediaAccess, "ALLOWED">, string> = {
  DISABLED: MEDIA_PREVIEW_DISABLED_NOTE,
  REVIEWER_ONLY: MEDIA_PREVIEW_REVIEWER_ONLY_NOTE,
};

/** An existing run and the version of it the caller last saw. */
export type GoalTarget = { id: string; expectedVersion: number };

/** The Studio has no producer login (reviewers sign in for review); actions are attributed to the Studio. */
const ACTOR = "pulse-studio";
/** Replacement moments the recovery engine searches and re-checks per "Find a way to use it". */
const REPLACEMENTS = 3;

const stale = () => new AppError("CONFLICT", "This goal was updated elsewhere — reload it before continuing.");

async function load(target: GoalTarget): Promise<GoalRun> {
  const { run, version } = await goalRuns.getVersioned(target.id);
  if (version !== target.expectedVersion) throw stale();
  return run;
}

/**
 * Writes only if nobody else wrote since `version` was read; returns the run and its new version.
 * `provenance` = where the upstream reads of this action came from (merged into the run's `dataOrigin`).
 */
async function save(id: string, version: number, mutate: (run: GoalRun) => void, provenance?: RunProvenance): Promise<{ run: GoalRun; version: number }> {
  const run = await goalRuns.update(
    id,
    (r) => {
      mutate(r);
      if (provenance) r.dataOrigin = mergeProvenance(r.dataOrigin, provenance);
    },
    version,
  );
  return { run, version: version + 1 };
}

/** Keys and links of every moment the view shows (top three, the selected one, current replacement options). */
async function present(run: GoalRun, version: number, deps: GoalDeps): Promise<GoalView> {
  const receipt = run.review ? await getReceipt(run.review.receiptId) : null;
  const shown = new Map<string, MediaRef>();
  for (const r of [...run.pool.slice(0, 3), ...run.adopted.filter((a) => a.key === run.campaign?.key)]) shown.set(r.key, r.media);
  const previews = new Map<string, Preview>();
  if (deps.media !== "ALLOWED") {
    // No stream lookups at all, and no thumbnail/preview URL anywhere in the view.
    return forMediaAccess(deps.media, buildGoalView(run, { version, receipt, previews, previewUnavailable: UNAVAILABLE_NOTE[deps.media] }));
  }
  await Promise.all(
    [...shown].map(async ([key, ref]) => {
      const p = await deps.preview(ref, run.club);
      if (p) previews.set(key, p);
    }),
  );
  return buildGoalView(run, { version, receipt, previews });
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

/** The latest evaluation, required to be of the campaign's current version and the run's current rule package. */
function currentEvaluation(run: GoalRun): GoalEvaluation {
  const latest = latestEvaluation(run);
  if (!latest || latest.campaignVersion !== run.campaign?.version) throw new AppError("BAD_REQUEST", "Check rights with REROUTE for this version first.");
  if (!underRunPolicy(run, latest)) throw new AppError("BAD_REQUEST", "The rule package changed since the last check — check rights again.");
  return latest;
}

/** First per-use decision with the overall (worst) verdict: the use REROUTE's resolver works on. */
function blockingUse(e: GoalEvaluation) {
  return e.perIntent.find((p) => p.decision.verdict === e.overall.verdict) ?? e.perIntent[0];
}

/** A campaign version only ever moves forward. */
function setCampaign(run: GoalRun, campaign: GoalCampaign) {
  if (run.campaign && run.campaign.version >= campaign.version) throw stale();
  run.campaign = campaign;
}

/** Builds, versions (campaigns repo) and audits a campaign for `rec`; returns the stored version. */
async function newVersion(
  run: GoalRun,
  rec: Recommendation,
  origin: GoalCampaign["origin"],
  now: Date,
  opts: { destination?: CommerceDestination; plan?: GoalPlan; edl?: GoalCampaign["edl"] | null } = {},
): Promise<GoalCampaign> {
  const previous = run.campaign;
  const campaignId = previous?.campaignId ?? randomUUID();
  const product = run.objective.product?.key;
  const kind = product && PRODUCTS[product].commerce;
  const kept = previous?.cta.destination?.source === "PRODUCER_ENTERED" ? previous.cta.destination : undefined;
  const dest = product && kind ? (opts.destination ?? kept ?? configuredDestination(run.club, product, kind, run.objective.market?.code)) : undefined;
  const plan = opts.plan ?? previous?.plan ?? run.plan;
  // A derived cut stays with its moment across later versions (destination, campaign changes) unless replaced.
  const edl = opts.edl === null ? undefined : (opts.edl ?? (previous?.key === rec.key ? previous.edl : undefined));
  const draft = buildGoalCampaign({ run, rec, campaignId, version: (previous?.version ?? 0) + 1, origin, plan, destination: dest, edl, now, previous });
  const version = await campaigns.saveVersion(campaignId, draft, ACTOR, { goalRunId: run.id });
  await events.append({
    subjectType: "campaign",
    subjectId: campaignId,
    type: "CAMPAIGN_VERSION_SAVED",
    actor: ACTOR,
    payload: { goalRunId: run.id, version, origin, key: rec.key, ...(edl ? { edl: { id: edl.id, retained: edl.retained, removed: edl.removed.map((r) => [r.start, r.end]), execution: edl.execution } } : {}) },
  });
  return { ...draft, version };
}

/** The run's rule package (Policy Center): the one it was set to, else the club's default. */
async function runPolicies(run: GoalRun, deps: GoalDeps): Promise<RunPolicies> {
  return deps.policies(run.club, run.policy?.packageId);
}

/**
 * Markets (or channels) of the campaign that no rule licenses, when NONE of them is licensed: nothing in the
 * footage can fix it and a reviewer cannot grant it. A partly licensed campaign is not a gap (keep the licensed part).
 */
function licenceGapOf(perIntent: GoalEvaluation["perIntent"], policies: readonly Policy[]): GoalEvaluation["licenceGap"] {
  const unlicensed = (dimension: "territory" | "platform", pick: (i: PublishIntent) => string) => {
    const all = [...new Set(perIntent.map((p) => pick(p.intent)))];
    const bad = all.filter((v) =>
      perIntent
        .filter((p) => pick(p.intent) === v)
        .every((p) => p.decision.reasons.some((r: Reason) => r.outcome !== "PERMIT" && r.dimension === dimension && reasonScope(r, policies) === "CAMPAIGN")),
    );
    return bad.length === all.length ? bad : [];
  };
  const territories = unlicensed("territory", (i) => i.territory.toUpperCase());
  const platforms = unlicensed("platform", (i) => i.platform);
  return territories.length || platforms.length ? { territories, platforms } : undefined;
}

/** Asks REROUTE about every channel × territory of the campaign (for a fresh publication slot) and records each decision. */
async function evaluate(run: GoalRun, campaign: GoalCampaign, kind: GoalEvaluation["kind"], deps: GoalDeps): Promise<GoalEvaluation> {
  const edit = campaignEdit(run.id, momentOf(run, campaign.key), campaign.edl);
  const publishAt = proposedPublishAt(deps.now());
  const { policies, context } = await runPolicies(run, deps);
  const result = await deps.decideCampaign({ edit, intents: campaign.intents.map((i) => ({ ...i, publishAt })), policies });
  const perIntent = result.perIntent.map((p) => ({ intent: p.intent, decision: p.decision.decision }));
  const records = await Promise.all(
    perIntent.map((p) =>
      evaluations.record({ campaignId: campaign.campaignId, campaignVersion: campaign.version, kind, media: result.media, intent: p.intent, decision: p.decision }),
    ),
  );
  // The evaluation is identified by the record of the worst use.
  const worst = Math.max(0, perIntent.findIndex((p) => p.decision.verdict === result.overall.verdict));
  const gap = licenceGapOf(perIntent, policies);
  const evaluation: GoalEvaluation = {
    id: records[worst].id,
    kind,
    campaignId: campaign.campaignId,
    campaignVersion: campaign.version,
    key: campaign.key,
    media: result.media,
    edit,
    overall: result.overall,
    perIntent,
    evaluatedAt: result.overall.evaluatedAt,
    ...(context ? { policy: context } : {}),
    ...(gap ? { licenceGap: gap } : {}),
  };
  await campaigns.setState(campaign.campaignId, { status: `RIGHTS_${result.overall.verdict}` });
  await events.append({
    subjectType: "campaign",
    subjectId: campaign.campaignId,
    type: kind === "ORIGINAL" ? "RIGHTS_EVALUATED" : "RECOVERY_RECHECKED",
    actor: ACTOR,
    payload: {
      goalRunId: run.id,
      version: campaign.version,
      verdict: result.overall.verdict,
      clearance: result.overall.clearance,
      policy: context ? { id: context.packageId, version: context.version, sourceType: context.sourceType, verified: context.verified } : null,
      edit: { id: edit.id, derived: edit.derived, segments: edit.segments.map((s) => [s.scoreplayMediaId, s.start, s.end]) },
      evaluationIds: records.map((r) => r.id),
      uses: perIntent.map((p) => `${p.intent.platform}/${p.intent.territory}/${p.intent.usage}:${p.decision.verdict}`),
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
  const plan = goalPlan(objective, club);
  const searching = trackProvenance(() => deps.search({ club, objective, match }));
  const policing = deps.policies(club);
  // Photos are listed while the video search runs, ranked once its moments are known, checked under the run's package.
  const suggest = deps.photos;
  const photoing =
    suggest &&
    trackProvenance(() => suggest({ club, objective, plan, moments: searching.then((s) => s.value.pool.slice(0, 3)), policies: policing.then((p) => p.policies) }));
  const [{ value: found, provenance }, { context: policy }, photos] = await Promise.all([searching, policing, photoing]);
  const dataOrigin = mergeProvenance(provenance, photos?.provenance);
  const run: GoalRun = {
    id: `goal-${randomUUID()}`,
    schemaVersion: 2,
    club,
    submittedAt: submittedAt.toISOString(),
    resultsAt: deps.now().toISOString(),
    objective,
    plan,
    match,
    ...found,
    ...(photos ? { attempts: [...found.attempts, photos.value.attempt], photos: photos.value.photos } : {}),
    ...(photos?.value.note ? { photosNote: photos.value.note } : {}),
    adopted: [],
    evaluations: [],
    recoveries: [],
    applied: [],
    ...(policy ? { policy } : {}),
    ...(dataOrigin ? { dataOrigin } : {}),
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
  if (!top) return present(run, 1, deps);
  const campaign = await newVersion(run, top, "PROPOSAL", deps.now());
  const saved = await save(run.id, 1, (r) => {
    setCampaign(r, campaign);
    r.selectedKey = top.key;
    r.proposalAt = campaign.createdAt;
  });
  return present(saved.run, saved.version, deps);
}

/** One goal run; null when the id is unknown. */
export async function getGoal(id: string, deps: GoalDeps = defaultDeps): Promise<GoalView | null> {
  try {
    const { run, version } = await goalRuns.getVersioned(id);
    return await present(run, version, deps);
  } catch (err) {
    if (err instanceof AppError && err.code === "NOT_FOUND") return null;
    throw err;
  }
}

/** Switches the proposal to another of the goal's moments (new campaign version). */
export async function selectMoment(target: GoalTarget, key: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await load(target);
  const rec = momentOf(run, key);
  if (run.campaign?.key === key) return present(run, target.expectedVersion, deps);
  const campaign = await newVersion(run, rec, "SELECTED", deps.now());
  const saved = await save(run.id, target.expectedVersion, (r) => {
    setCampaign(r, campaign);
    r.selectedKey = key;
    r.proposalAt ??= campaign.createdAt;
  });
  return present(saved.run, saved.version, deps);
}

/** Updates the proposal's details — today the commerce destination (https, on the club's domain). */
export async function draftGoalCampaign(target: GoalTarget, commerceUrl: string | undefined, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await load(target);
  const current = currentCampaign(run);
  const product = run.objective.product?.key;
  const kind = product && PRODUCTS[product].commerce;
  if (commerceUrl && !kind) throw new AppError("BAD_REQUEST", "This goal has no store or ticketing destination.");
  if (commerceUrl && !onClubDomain(run.club, commerceUrl)) {
    throw new AppError("BAD_REQUEST", `The link must be https on the club's own domain (${CLUBS[run.club].domains.join(", ")}).`);
  }
  const destination: CommerceDestination | undefined = commerceUrl && kind ? { kind, url: commerceUrl, source: "PRODUCER_ENTERED" } : undefined;
  const campaign = await newVersion(run, momentOf(run, current.key), "DESTINATION", deps.now(), { destination });
  const saved = await save(run.id, target.expectedVersion, (r) => setCampaign(r, campaign));
  return present(saved.run, saved.version, deps);
}

/** Sends the current campaign version through REROUTE for every channel × territory. */
export async function checkGoalRights(target: GoalTarget, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await load(target);
  const campaign = currentCampaign(run);
  const recheck = campaign.origin === "ALTERNATIVE" || campaign.origin === "EDIT" || campaign.origin === "REMEDY";
  const { value: evaluation, provenance } = await trackProvenance(() => evaluate(run, campaign, recheck ? "ALTERNATIVE" : "ORIGINAL", deps));
  const saved = await save(
    run.id,
    target.expectedVersion,
    (r) => {
      r.evaluations.push(evaluation);
    },
    provenance,
  );
  return present(saved.run, saved.version, deps);
}

/** The recovery plan of the latest evaluation of the current moment, if any. */
function currentRecovery(run: GoalRun, latest: GoalEvaluation): GoalRecovery | undefined {
  return run.recoveries.findLast((r) => r.forEvaluationId === latest.id && r.forKey === run.campaign?.key);
}

/**
 * "Find a way to use it" (Media Compliance Recovery Engine): locates every restriction of the latest evaluation
 * in the footage or in the plan, proposes trims, a clean section, real replacement moments, a campaign change,
 * a change of use or a clearance request — and re-checks each one independently for every use. Persisted and
 * audited; never repeated for the same evaluation.
 */
export async function findRecovery(target: GoalTarget, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await load(target);
  const latest = currentEvaluation(run);
  if (latest.overall.verdict === "ALLOWED") throw new AppError("BAD_REQUEST", "Every planned use is already allowed; there is nothing to fix.");
  if (currentRecovery(run, latest)) return present(run, target.expectedVersion, deps);

  const campaign = currentCampaign(run);
  const rec = momentOf(run, latest.key);
  const edl = campaign.edl;
  const source = {
    assetId: rec.candidate.scoreplayAssetId,
    title: rec.candidate.title,
    range: edl ? edl.sourceRange : { start: rec.candidate.startSeconds ?? 0, end: rec.candidate.endSeconds ?? (rec.candidate.startSeconds ?? 0) + 15 },
    ...(edl ? { priorRemovals: edl.removed.filter((r) => r.ruleIds.length > 0) } : {}),
  };
  const { policies, context } = await runPolicies(run, deps);
  const policyTitle = context?.title ?? "Rights policy";
  const { value: recovered, provenance } = await trackProvenance(() =>
    deps.recover({
      source,
      intents: latest.perIntent.map((p) => p.intent),
      query: rec.matches[0]?.query ?? rec.headline,
      replacements: REPLACEMENTS,
      idPrefix: `${campaign.campaignId}:v${campaign.version}`,
      policies,
    }),
  );
  const { plan } = recovered;
  const options = plan.options.map((o) => storedOption(o, plan.recommendedId, recovered.media, policyTitle));
  const record = await alternatives.record({
    evaluationId: latest.id,
    blocker: {
      scope: plan.scope === "CLIP" ? "CLIP" : "CAMPAIGN",
      dimensions: [...new Set(plan.problems.map((p) => (p.scope === "CAMPAIGN" ? "campaign" : "footage")))],
      ruleIds: [...new Set(plan.problems.flatMap((p) => p.ruleIds))],
      explanation: plan.headline,
      ...(plan.noPathMessage ? { suggestion: plan.noPathMessage } : {}),
    },
    candidates: options.map((o) => ({
      ...RecoveryOptionSchema.parse(o),
      ...(o.edl ? { edl: { id: o.edl.id, retained: o.edl.retained, removed: o.edl.removed.map((r) => ({ start: r.start, end: r.end, ruleIds: r.ruleIds })) } } : {}),
    })),
  });
  const found: GoalRecovery = {
    id: record.id,
    forEvaluationId: latest.id,
    forKey: latest.key,
    generatedAt: deps.now().toISOString(),
    scope: plan.scope,
    headline: plan.headline,
    problems: plan.problems.map((p) => problemLine(p, policyTitle)),
    options,
    ...(plan.recommendedId ? { recommendedId: plan.recommendedId } : {}),
    ...(plan.noPathMessage ? { noPathMessage: plan.noPathMessage } : {}),
    media: recovered.media,
  };
  await events.append({
    subjectType: "campaign",
    subjectId: latest.campaignId,
    type: "RECOVERY_PLANNED",
    actor: ACTOR,
    payload: {
      goalRunId: run.id,
      evaluationId: latest.id,
      recoveryId: record.id,
      scope: plan.scope,
      recommended: plan.recommendedId ?? null,
      options: options.map((o) => `${o.id}:${o.outcome}${o.recheck ? `:${o.recheck.allowedUses}/${o.recheck.totalUses}` : ""}`),
      policy: context ? `${context.packageId}@${context.version}` : null,
    },
  });
  const saved = await save(
    run.id,
    target.expectedVersion,
    (r) => {
      r.recoveries.push(found);
    },
    provenance,
  );
  return present(saved.run, saved.version, deps);
}

/** A replacement option as a goal moment (its MediaRef re-resolved server-side, never trusted from the plan). */
function replacementMoment(run: GoalRun, from: GoalRecovery, o: StoredRecoveryOption, media: MediaRef): Recommendation {
  const original = momentOf(run, from.forKey);
  const r = o.replacement!;
  const title = media.match?.scoreplayFilename ?? r.title;
  return {
    key: r.key,
    candidate: {
      scoreplayAssetId: r.scoreplayMediaId,
      twelveLabsVideoId: media.twelvelabsVideoId,
      title,
      kind: "video",
      durationSec: media.match?.scoreplayDurationSec,
      startSeconds: r.start,
      endSeconds: r.end,
      competition: original.candidate.competition,
      foundBy: "TWELVELABS",
      discoveredBy: "INDEX_SEARCH",
      rank: r.rank,
      query: r.query,
      origin: "LIVE",
      mapping: { via: media.method as "AUTHORITATIVE_ID" | "FILENAME_DURATION", filename: media.match?.twelvelabsFilename ?? title },
    },
    media,
    headline: `${original.headline} (replacement)`,
    score: 0,
    breakdown: {
      relevance: 0,
      readiness: 0,
      contextFactor: 1,
      notes: {
        relevance: `Found by the recovery engine: #${r.rank} for “${r.query}”.`,
        readiness: "Cut to the same length as the restricted moment.",
        context: `Replaces ${from.forKey}.`,
      },
    },
    matches: [{ ...original.matches[0], query: r.query, rank: r.rank, start: r.start, end: r.end }],
    why: {
      opportunity: original.why.opportunity,
      media: `PULSE found this ${Math.round(r.end - r.start)}-second moment at ${clock(r.start)}–${clock(r.end)} in “${title}” as comparable footage, and checked it independently.`,
      action: original.why.action,
    },
    duplicates: [],
    previewNote: "",
  };
}

/**
 * Applies one option of the CURRENT recovery plan as a new campaign version and re-evaluates every use from
 * scratch (the plan's own re-check is never copied). TRIM / SAFE_SECTION → derived cut (edit plan, not rendered);
 * REPLACE → the replacement moment; ADAPT_CAMPAIGN / CHANGE_USAGE → the changed plan.
 */
export async function applyRecovery(target: GoalTarget, optionId: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await load(target);
  const latest = currentEvaluation(run);
  const from = currentRecovery(run, latest);
  const option = from?.options.find((o) => o.id === optionId);
  if (!from || !option) throw new AppError("BAD_REQUEST", "That option is not part of the current recovery plan for this campaign. Find a way to use it again.");
  if (!option.applicable) throw new AppError("BAD_REQUEST", option.notViableBecause ?? "This option does not resolve the restriction; it can't be applied.");
  const campaign = currentCampaign(run);
  const now = deps.now();

  const { value, provenance } = await trackProvenance(async () => {
    let withMoment = run;
    let next: GoalCampaign;
    if (option.kind === "TRIM" || option.kind === "SAFE_SECTION") {
      if (!option.edl) throw new AppError("BAD_REQUEST", "This option has no edit plan.");
      next = await newVersion(run, momentOf(run, latest.key), "EDIT", now, { edl: option.edl });
    } else if (option.kind === "REPLACE") {
      const r = option.replacement!;
      const media = await deps.resolveMedia(r.scoreplayMediaId, run.club);
      if (!isEvidenceLinkable(media)) {
        throw new AppError("BAD_REQUEST", `ScorePlay asset ${r.scoreplayMediaId} has no unique TwelveLabs link (${media.method}); it cannot be used.`);
      }
      const rec = replacementMoment(run, from, option, media);
      withMoment = { ...run, adopted: [...run.adopted.filter((a) => a.key !== rec.key), rec] };
      next = await newVersion(withMoment, rec, "ALTERNATIVE", now, { edl: null });
    } else if (option.kind === "ADAPT_CAMPAIGN" || option.kind === "CHANGE_USAGE") {
      const change = option.campaignChange ?? {};
      const plan = campaign.plan;
      const territories = change.territories?.length ? plan.territories.filter((t) => change.territories!.includes(t)) : plan.territories;
      const channels = change.platforms?.length ? plan.channels.filter((c) => change.platforms!.includes(c)) : plan.channels;
      if (!territories.length || !channels.length) throw new AppError("BAD_REQUEST", "This change would leave no planned use.");
      const changed: GoalPlan = {
        ...plan,
        territories,
        channels,
        usage: change.usage ?? plan.usage,
        territoryBasis: change.dropped?.length ? `Limited by the recovery engine to licensed markets: ${territories.join(", ")}.` : plan.territoryBasis,
      };
      next = await newVersion(run, momentOf(run, campaign.key), "REMEDY", now, { plan: changed });
    } else {
      throw new AppError("BAD_REQUEST", "A clearance request is a next step for a person, not a change PULSE can apply.");
    }
    const evaluation = await evaluate(withMoment, next, "ALTERNATIVE", deps);
    return { withMoment, next, evaluation };
  });
  const { withMoment, next, evaluation } = value;
  await events.append({
    subjectType: "campaign",
    subjectId: campaign.campaignId,
    type: "RECOVERY_APPLIED",
    actor: ACTOR,
    payload: {
      goalRunId: run.id,
      recoveryId: from.id,
      optionId,
      kind: option.kind,
      fromEvaluationId: latest.id,
      version: next.version,
      before: latest.overall.verdict,
      after: evaluation.overall.verdict,
      predicted: option.recheck?.verdict ?? null,
    },
  });
  const saved = await save(
    run.id,
    target.expectedVersion,
    (r) => {
      r.adopted = withMoment.adopted;
      setCampaign(r, next);
      r.selectedKey = next.key;
      r.evaluations.push(evaluation);
      r.applied.push({ recoveryId: from.id, optionId, kind: option.kind, title: option.title, fromEvaluationId: latest.id, fromKey: latest.key, campaignVersion: next.version, at: now.toISOString() });
    },
    provenance,
  );
  return present(saved.run, saved.version, deps);
}

/** Evaluates this run against another rule package of its club (Policy Center); the verdict is stale until re-checked. */
export async function setRunPolicy(target: GoalTarget, packageId: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await load(target);
  const { context } = await deps.policies(run.club, packageId);
  if (!context || context.packageId !== packageId) {
    throw new AppError("BAD_REQUEST", `Rule package "${packageId}" does not exist or does not apply to ${CLUBS[run.club].label}.`);
  }
  if (run.policy?.packageId === context.packageId && run.policy.version === context.version) return present(run, target.expectedVersion, deps);
  await events.append({
    subjectType: "goal",
    subjectId: run.id,
    type: "POLICY_CONTEXT_CHANGED",
    actor: ACTOR,
    payload: { from: run.policy ? `${run.policy.packageId}@${run.policy.version}` : null, to: `${context.packageId}@${context.version}`, sourceType: context.sourceType, verified: context.verified },
  });
  const saved = await save(run.id, target.expectedVersion, (r) => {
    r.policy = context;
  });
  return present(saved.run, saved.version, deps);
}

/**
 * Sends the latest evaluation of the current version to human review: allowed for ALLOWED (any
 * clearance) or NEEDS_REVIEW, never BLOCKED. Creates the REROUTE audit receipt covering every use;
 * the review itself is POST /api/receipts/[id]/review.
 */
export async function submitForReview(target: GoalTarget, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await load(target);
  const campaign = currentCampaign(run);
  const latest = currentEvaluation(run);
  if (latest.overall.verdict === "BLOCKED") throw new AppError("BAD_REQUEST", "REROUTE blocked this campaign; a blocked campaign cannot be submitted. Find another way first.");
  if (run.review?.evaluationId === latest.id) return present(run, target.expectedVersion, deps);
  if (latest.licenceGap) throw new AppError("BAD_REQUEST", `${noLicenceReason(latest.licenceGap)}.`);

  const receipt = await createReceipt({
    edit: latest.edit,
    intent: blockingUse(latest).intent,
    intents: latest.perIntent.map((p) => p.intent),
    decision: latest.overall,
    campaignId: campaign.campaignId,
    campaignVersion: campaign.version,
    media: latest.media,
    actor: ACTOR,
  });
  await campaigns.setState(campaign.campaignId, { status: "IN_REVIEW" });
  await events.append({
    subjectType: "campaign",
    subjectId: campaign.campaignId,
    type: "SUBMITTED_FOR_REVIEW",
    actor: ACTOR,
    payload: { goalRunId: run.id, version: campaign.version, receiptId: receipt.id, evaluationId: latest.id, verdict: latest.overall.verdict, clearance: latest.overall.clearance },
  });
  const saved = await save(run.id, target.expectedVersion, (r) => {
    r.review = { receiptId: receipt.id, submittedAt: deps.now().toISOString(), campaignVersion: campaign.version, evaluationId: latest.id };
  });
  return present(saved.run, saved.version, deps);
}
