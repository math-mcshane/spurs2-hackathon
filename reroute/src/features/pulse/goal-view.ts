import { canPublish, DEMO_CLEARANCE_LABEL, type Decision, type PublishIntent, type Reason, type RightsReceipt } from "@/lib/contracts";
import { withPreview } from "./moment-ranking";
import { MARKETS, PRODUCTS } from "./objective-parser";
import { MarketCodeSchema } from "./types";
import type {
  ChannelRights,
  GoalAlternatives,
  GoalEvaluation,
  GoalPlan,
  GoalRun,
  GoalView,
  Preview,
  Product,
  Recommendation,
  RecommendationView,
  ReviewStatus,
  RightsIssue,
  RightsView,
} from "./types";

/**
 * Presentation of a goal run. Rights wording is a plain-English rendering of REROUTE's recorded
 * decisions — PULSE never computes, upgrades or softens a verdict. Publication is decided by one rule
 * only: `canPublish()` on the review receipt (verified clearance AND human approval).
 */

const TOPIC: Record<string, string> = {
  territory: "Territory",
  platform: "Platform",
  usage: "Type of use",
  competition: "Competition licence",
  expiry: "Licence dates",
  people: "People on screen",
  sponsor: "Sponsors and brands on screen",
};
const LICENCE: Record<string, true> = { territory: true, platform: true, usage: true, competition: true, expiry: true };
const PLATFORM: Record<string, string> = { instagram: "Instagram", x: "X", youtube: "YouTube", facebook: "Facebook", tiktok: "TikTok" };
const USAGE: Record<PublishIntent["usage"], string> = { COMMERCIAL: "Commercial", EDITORIAL: "Editorial", ORGANIC: "Organic", SPONSORED: "Sponsored" };

export function describeUse(intent: PublishIntent): string {
  const market = MarketCodeSchema.safeParse(intent.territory);
  const country = market.success ? MARKETS[market.data].label : intent.territory;
  return `${USAGE[intent.usage]} ${PLATFORM[intent.platform] ?? intent.platform} post in ${country} (${intent.territory}) · ${intent.competition}`;
}

const countryOf = (territory: string) => {
  const market = MarketCodeSchema.safeParse(territory);
  return market.success ? `${MARKETS[market.data].label} (${territory})` : territory;
};

type Remedy = NonNullable<GoalAlternatives["remedy"]>;

/**
 * REROUTE's remedy for a CAMPAIGN blocker, kept inside the campaign's own uses. When no requested
 * territory (or channel) is licensed, REROUTE lists what the policy licenses ELSEWHERE — that would
 * re-target the goal, not fix it — so PULSE offers no remedy and reports a licence gap instead.
 */
export function scopeRemedy(found: Pick<GoalAlternatives, "blocker" | "remedy">, plan: Pick<GoalPlan, "territories" | "channels">): { remedy?: Remedy; gap?: { territories: string[]; platforms: string[] } } {
  if (found.blocker.scope !== "CAMPAIGN") return {};
  const r = found.remedy ?? {};
  const territories = r.territories?.filter((t) => plan.territories.includes(t));
  const platforms = r.platforms?.filter((p) => (plan.channels as string[]).includes(p));
  const gap = {
    territories: found.blocker.dimensions.includes("territory") && !territories?.length ? [...plan.territories] : [],
    platforms: found.blocker.dimensions.includes("platform") && !platforms?.length ? [...plan.channels] : [],
  };
  if (gap.territories.length || gap.platforms.length) return { gap };
  const remedy: Remedy = {
    ...(territories?.length ? { territories } : {}),
    ...(platforms?.length ? { platforms } : {}),
    ...(r.usage ? { usage: r.usage } : {}),
  };
  return Object.keys(remedy).length ? { remedy } : {};
}

/** Why a licence gap cannot go to review: a human reviewer cannot grant a missing licence. */
export function noLicenceReason(gap: { territories: string[]; platforms: string[] }): string {
  const what = [...gap.territories.map(countryOf), ...gap.platforms.map((p) => PLATFORM[p] ?? p)].join(", ");
  return `No licence covers ${what} — request a licence before review`;
}

/** Plain-English licence gap: no licensed path for the campaign's market(s) — request a licence, no remedy. */
function licenceGap(gap: { territories: string[]; platforms: string[] }, policy: Pick<Decision, "policyId" | "policyFictional">): NonNullable<GoalView["licenceGap"]> {
  const where = gap.territories.map(countryOf).join(", ");
  const channels = gap.platforms.map((p) => PLATFORM[p] ?? p).join(", ");
  const what = [gap.territories.length && `in ${where}`, gap.platforms.length && `on ${channels}`].filter(Boolean).join(" or ");
  const ask = [gap.territories.length && gap.territories.join(", "), gap.platforms.length && channels].filter(Boolean).join(" / ");
  return {
    label: `No licensed path ${what}`,
    description:
      `REROUTE's policy ${policy.policyId}${policy.policyFictional ? " (DEMO)" : ""} licenses none of this campaign's uses ${what}. ` +
      `Another clip would hit the same restriction and no remedy exists inside this goal — PULSE will not re-target it to other markets. ` +
      `Next step: request a licence for ${ask} from the rights holder.`,
    territories: gap.territories,
    platforms: gap.platforms,
  };
}

/** One-line KPI value while no commerce or analytics integration is connected (always, today). */
const KPI_NOT_CONNECTED: Record<Product | "default", string> = {
  jersey: "Sales attribution not connected.",
  merch: "Sales attribution not connected.",
  tickets: "Sales attribution not connected.",
  subscriptions: "Sales attribution not connected.",
  engagement: "Engagement measurement not connected.",
  followers: "Engagement measurement not connected.",
  sponsor: "Sponsor delivery tracking not connected.",
  default: "Business results not connected.",
};

/**
 * The goal's KPI: label from the objective, no value. The goal flow has no deliverable ledger, so a
 * sponsor objective is NOT_CONNECTED here (the board's ledger is a different flow).
 */
export function goalKpi(objective: GoalRun["objective"]): GoalView["kpi"] {
  const product = objective.product?.key;
  const measurement =
    product === "sponsor"
      ? { status: "NOT_CONNECTED" as const, note: "Sponsor deliverables are not tracked in the goal flow — nothing is counted, predicted or claimed." }
      : objective.measurement;
  return {
    label: objective.kpi,
    value: null,
    valueText: KPI_NOT_CONNECTED[product ?? "default"],
    status: measurement.status,
    note: `${measurement.note} No value is shown until a verified source is connected.`,
  };
}

/**
 * REROUTE reasons as plain-English topics: dimensions REROUTE explained with the same sentence are
 * one topic (e.g. all licence terms), and each topic lists REROUTE's explanations verbatim.
 */
export function rightsIssues(reasons: readonly Pick<Reason, "dimension" | "outcome" | "explanation">[]): RightsIssue[] {
  const byExplanation = new Map<string, { outcome: "DENY" | "MISSING"; dimensions: string[] }>();
  for (const r of reasons) {
    if (r.outcome === "PERMIT") continue;
    const g = byExplanation.get(r.explanation) ?? { outcome: r.outcome, dimensions: [] };
    if (r.outcome === "DENY") g.outcome = "DENY";
    if (!g.dimensions.includes(r.dimension)) g.dimensions.push(r.dimension);
    byExplanation.set(r.explanation, g);
  }
  const byTopic = new Map<string, RightsIssue>();
  for (const [explanation, g] of byExplanation) {
    const topic = g.dimensions.length > 1 && g.dimensions.every((d) => LICENCE[d]) ? "Licence terms" : g.dimensions.map((d) => TOPIC[d] ?? d).join(" · ");
    const issue = byTopic.get(topic) ?? { topic, outcome: g.outcome, dimensions: [], explanations: [] };
    if (g.outcome === "DENY") issue.outcome = "DENY";
    issue.dimensions = [...new Set([...issue.dimensions, ...g.dimensions])];
    issue.explanations.push(explanation);
    byTopic.set(topic, issue);
  }
  return [...byTopic.values()].sort((a, b) => Number(b.outcome === "DENY") - Number(a.outcome === "DENY"));
}

const isDemo = (d: Pick<Decision, "policyFictional" | "clearance">) => d.policyFictional || d.clearance === "DEMO";

function channelRights(intent: PublishIntent, d: Decision): ChannelRights {
  return {
    channel: intent.platform,
    territory: intent.territory,
    use: describeUse(intent),
    verdict: d.verdict,
    clearance: d.clearance,
    policyId: d.policyId,
    policyVersion: d.policyVersion,
    policyFictional: d.policyFictional,
    policySelection: d.policySelection,
    reasons: d.reasons,
    issues: rightsIssues(d.reasons),
    missingFacts: d.missingFacts,
  };
}

/** The latest evaluation of the campaign's current moment (any version), if REROUTE evaluated it. */
export function latestEvaluation(run: GoalRun): GoalEvaluation | undefined {
  const c = run.campaign;
  return c ? run.evaluations.findLast((e) => e.campaignId === c.campaignId && e.key === c.key) : undefined;
}

export function presentRights(run: GoalRun): RightsView {
  const e = latestEvaluation(run);
  if (!e) {
    return {
      state: "NOT_CHECKED",
      headline: "Not checked yet",
      detail: "REROUTE has not evaluated this proposal yet. Nothing is cleared until it does.",
      current: false,
      perIntent: [],
      issues: [],
      missingFacts: [],
    };
  }
  const d = e.overall;
  const perIntent = e.perIntent.map((p) => channelRights(p.intent, p.decision));
  const demo = isDemo(d) || e.perIntent.some((p) => isDemo(p.decision));
  const counts = { ALLOWED: 0, NEEDS_REVIEW: 0, BLOCKED: 0 };
  for (const p of perIntent) counts[p.verdict]++;
  const tally = `${perIntent.length} use${perIntent.length === 1 ? "" : "s"} checked: ${counts.ALLOWED} allowed, ${counts.NEEDS_REVIEW} need review, ${counts.BLOCKED} blocked.`;
  const issues = rightsIssues(e.perIntent.flatMap((p) => p.decision.reasons));
  const copy: Record<Decision["verdict"], { headline: string; detail: string }> = {
    ALLOWED: demo
      ? { headline: "Allowed under a demo policy", detail: `${DEMO_CLEARANCE_LABEL}. ${tally} This can go to review for the demo, but it can never authorize publication.` }
      : { headline: "Cleared by REROUTE for every proposed use", detail: `${tally} Policy ${d.policyId} v${d.policyVersion}.` },
    NEEDS_REVIEW: { headline: "Needs a rights review", detail: `REROUTE could not confirm everything. ${tally} A person must review it — or find another way.` },
    BLOCKED: { headline: "Restricted for at least one proposed use", detail: `REROUTE found a restriction PULSE cannot override. ${tally} Find another way to keep the same goal.` },
  };
  return {
    state: d.verdict,
    clearance: d.clearance,
    clearanceLabel: demo ? DEMO_CLEARANCE_LABEL : undefined,
    ...copy[d.verdict],
    evaluationId: e.id,
    kind: e.kind,
    campaignVersion: e.campaignVersion,
    evaluatedAt: e.evaluatedAt,
    current: e.campaignVersion === run.campaign?.version,
    perIntent,
    issues,
    missingFacts: [...new Set(e.perIntent.flatMap((p) => p.decision.missingFacts))],
  };
}

function recommendationView(run: GoalRun, rec: Recommendation, previews: ReadonlyMap<string, Preview>): RecommendationView {
  const e = run.evaluations.findLast((x) => x.key === rec.key);
  const shown = withPreview(rec, previews.get(rec.key), PREVIEW_UNAVAILABLE);
  return { ...shown, rights: e ? { state: e.overall.verdict, clearance: e.overall.clearance } : { state: "NOT_CHECKED" } };
}

const PREVIEW_UNAVAILABLE = "No browser-playable stream is available for this video (or previews are switched off).";

/** The review receipt for the current campaign version, if one was submitted. */
type Receipt = Pick<RightsReceipt, "id" | "decision" | "humanReviewStatus" | "writeback">;

/** Plain-English label for a REROUTE remedy (the licensed subset of the campaign's uses). */
export function remedyLabel(remedy: NonNullable<GoalAlternatives["remedy"]>): string {
  return [
    remedy.territories?.length && `Limit to licensed territories: ${remedy.territories.join(", ")}`,
    remedy.platforms?.length && `Limit to licensed channels: ${remedy.platforms.join(", ")}`,
    remedy.usage && `Switch the use to ${remedy.usage.toLowerCase()}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

function nextStep(
  run: GoalRun,
  rights: RightsView,
  review: ReviewStatus,
  canSubmit: boolean,
  publishable: boolean,
  remedy: boolean,
  gap: GoalView["licenceGap"],
): string {
  if (!run.campaign) return run.pool.length ? "Pick one of the three moments to build its campaign." : "No usable moment was found — refine the goal or index more footage.";
  if (run.campaign.cta.status === "NOT_CONFIGURED" && review === "NOT_SUBMITTED" && rights.state === "NOT_CHECKED") {
    const link = run.objective.product && PRODUCTS[run.objective.product.key].commerce === "ticketing" ? "ticketing link" : "store link";
    return `Check rights with REROUTE. The ${link} is not configured — add an https link on the club's domain (optional before review).`;
  }
  if (rights.state === "NOT_CHECKED" || !rights.current) return "Check rights with REROUTE for every proposed channel and territory.";
  if (review === "APPROVED")
    return publishable
      ? "Approved with verified clearance — ready to publish outside PULSE, then record the ScorePlay writeback."
      : `Approved by a reviewer, but not publishable: ${rights.clearanceLabel ?? "the clearance is not verified"}. Run the ScorePlay writeback (dry-run) to record the decision.`;
  if (review === "REJECTED") return "The reviewer rejected this version. Find another way or change the proposal, then submit again.";
  if (review === "PENDING") return "Waiting for a reviewer to approve or reject the receipt.";
  if (gap) return `${noLicenceReason(gap)}. PULSE offers no remedy and never re-targets the goal to other markets.`;
  if (remedy) return "The restriction is tied to where or how the campaign runs, not to the clip: apply REROUTE's remedy, then check rights again.";
  if (rights.state === "BLOCKED") return "Restricted. Find another way: REROUTE searches comparable footage and re-checks it independently.";
  if (canSubmit)
    return rights.state === "NEEDS_REVIEW"
      ? "Submit for human review — or find another way first."
      : "Submit for human review to create the audit receipt.";
  return "Check rights again.";
}

export function buildGoalView(
  run: GoalRun,
  opts: { version: number; receipt?: Receipt | null; previews?: ReadonlyMap<string, Preview> },
): GoalView {
  const { pool, adopted, campaign: draft } = run;
  const previews = opts.previews ?? new Map<string, Preview>();
  const rights = presentRights(run);
  const latest = latestEvaluation(run);
  const all = [...pool, ...adopted];
  const selectedRec = draft ? all.find((r) => r.key === draft.key) : undefined;

  // A submission only counts while it is for the latest evaluation: any re-check supersedes it.
  const submitted = run.review && latest && run.review.evaluationId === latest.id && rights.current ? run.review : undefined;
  const liveReceipt = submitted && opts.receipt?.id === submitted.receiptId ? opts.receipt : undefined;
  const reviewStatus: ReviewStatus = submitted ? (liveReceipt?.humanReviewStatus ?? "PENDING") : "NOT_SUBMITTED";
  const publishable = !!liveReceipt && canPublish(liveReceipt);
  const lastWrite = liveReceipt?.writeback.at(-1);

  // "Find another way" results are bound to the evaluation that produced them.
  const found = latest && rights.current ? run.alternatives.findLast((a) => a.forEvaluationId === latest.id && a.forKey === latest.key) : undefined;
  const alternatives = found && {
    ...found,
    candidates: found.candidates.map((c) => ({ ...c, preview: previews.get(c.key) })),
  };
  // REROUTE's remedy, kept inside the campaign's own uses; an empty licensed subset is a licence gap, not a remedy.
  const scoped = found ? scopeRemedy(found, draft?.plan ?? run.plan) : {};
  const remedy = scoped.remedy && {
    label: remedyLabel(scoped.remedy),
    description: found!.blocker.suggestion ?? found!.blocker.explanation,
    ...scoped.remedy,
  };
  const gap = scoped.gap && latest ? licenceGap(scoped.gap, latest.overall) : undefined;
  // A reviewer cannot grant a missing licence: a licence gap is never submittable.
  const canSubmit = !!latest && rights.current && latest.overall.verdict !== "BLOCKED" && !submitted && !gap;
  const kpi = goalKpi(run.objective);

  const commerce = run.objective.product && PRODUCTS[run.objective.product.key].commerce;
  const notLocalized = draft?.evidenceLabels.find((l) => l.startsWith("Copy not localized"));
  const campaign = draft && {
    ...draft,
    checklist: [
      { item: "Media and exact timestamps", status: "DONE" as const, note: `TwelveLabs moment on ScorePlay asset ${draft.mediaRef.scoreplayMediaId} (${draft.mediaRef.method}).` },
      notLocalized
        ? { item: "Localized copy", status: "MISSING" as const, note: notLocalized }
        : {
            item: "Localized copy",
            status: "DONE" as const,
            note: `Written in ${draft.audience.locale ?? draft.audience.language.toUpperCase()}.`,
          },
      ...(commerce
        ? [
            draft.cta.destination
              ? { item: "Destination URL", status: "DONE" as const, note: draft.cta.destination.source === "CONFIGURED" ? "Configured by the club." : "Entered by you on the club's domain." }
              : { item: "Destination URL", status: "MISSING" as const, note: "NOT_CONFIGURED: add an https link on the club's domain to enable the call to action." },
            { item: "Product inventory", status: "NOT_CONNECTED" as const, note: "No product feed: the copy makes no stock, price or availability claim." },
          ]
        : []),
      ...(run.objective.product?.key === "sponsor"
        ? [
            {
              item: "Partner credit",
              status: "MISSING" as const,
              note: "PULSE never names a sponsor: add the partner credit exactly as contracted. Only ScorePlay sponsor data or the rights policy's partner list can name one — neither designates which partner this activation is for.",
            },
          ]
        : []),
      rights.state === "NOT_CHECKED" || !rights.current
        ? { item: "Rights evaluation", status: "MISSING" as const, note: "Not checked for this version." }
        : { item: "Rights evaluation", status: "DONE" as const, note: `${rights.headline}. ${rights.clearanceLabel ?? ""}`.trim() },
      { item: "Performance tracking", status: "NOT_CONNECTED" as const, note: `${kpi.valueText} ${kpi.note}` },
      reviewStatus === "APPROVED" || reviewStatus === "REJECTED"
        ? { item: "Human review", status: "DONE" as const, note: `Reviewer decision: ${reviewStatus}.` }
        : { item: "Human review", status: "MISSING" as const, note: reviewStatus === "PENDING" ? "Waiting for a reviewer." : "Not submitted." },
    ],
  };

  const view = (r: Recommendation) => recommendationView(run, r, previews);
  const seconds = (to: string) => Math.round((Date.parse(to) - Date.parse(run.submittedAt)) / 100) / 10;
  return {
    version: opts.version,
    run: {
      id: run.id,
      club: run.club,
      submittedAt: run.submittedAt,
      resultsAt: run.resultsAt,
      objective: run.objective,
      plan: run.plan,
      match: run.match,
      matchFilter: run.matchFilter,
      intents: run.intents,
      library: run.library,
      search: run.search,
      attempts: run.attempts,
      selectedKey: run.selectedKey,
    },
    recommendations: pool.slice(0, 3).map(view),
    selected: selectedRec && view(selectedRec),
    campaign,
    rights,
    blocker: found?.blocker,
    alternatives,
    remedy,
    licenceGap: gap,
    evaluations: run.evaluations.map((e) => ({
      id: e.id,
      kind: e.kind,
      campaignVersion: e.campaignVersion,
      key: e.key,
      verdict: e.overall.verdict,
      clearance: e.overall.clearance,
      evaluatedAt: e.evaluatedAt,
    })),
    receiptId: submitted?.receiptId,
    reviewStatus,
    canSubmit,
    writeback: lastWrite ? { status: lastWrite.status, at: lastWrite.at, detail: lastWrite.detail } : { status: "NOT_STARTED" },
    publishable,
    publishNote: publishable
      ? "Verified clearance and human approval: publishable."
      : rights.clearanceLabel
        ? `${rights.clearanceLabel} — never publishable, even after approval.`
        : "Publishable only with a verified REROUTE clearance AND human approval.",
    nextStep: nextStep(run, rights, reviewStatus, canSubmit, publishable, !!remedy, gap),
    kpi,
    timing: { toRecommendationsSec: seconds(run.resultsAt), toProposalSec: run.proposalAt ? seconds(run.proposalAt) : undefined },
    dataOrigin: run.dataOrigin,
  };
}
