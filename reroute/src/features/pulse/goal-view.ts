import { canPublish, DEMO_CLEARANCE_LABEL, type Decision, type Evidence, type PublishIntent, type Reason, type RightsReceipt, type Sponsorship } from "@/lib/contracts";
import { CLUB_PARTNER_RULE_PREFIX, isUnverifiedPerson, normalizeLabel, TARGET_SPONSOR_RULE_PREFIX } from "@/lib/rights/engine";
import { EDL_EXECUTION_LABEL, type Edl } from "@/lib/rights/recovery/edl";
import { analysisRunLabel } from "@/lib/twelvelabs/runs";
import { withPreview } from "./moment-ranking";
import { MARKETS, PRODUCTS } from "./objective-parser";
import { MarketCodeSchema, RecoveryOptionSchema } from "./types";
import type {
  BeforeAfter,
  ChannelRights,
  EditTimeline,
  GoalEvaluation,
  GoalRun,
  GoalView,
  Preview,
  Product,
  Recommendation,
  RecommendationView,
  RecoveryOption,
  RecoveryView,
  ReviewStatus,
  RightsIssue,
  RightsView,
  StoredRecoveryOption,
  ReasonFinding,
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

/** Why a licence gap cannot go to review: a human reviewer cannot grant a missing licence. */
export function noLicenceReason(gap: { territories: string[]; platforms: string[] }): string {
  const what = [...gap.territories.map(countryOf), ...gap.platforms.map((p) => PLATFORM[p] ?? p)].join(", ");
  return `No licence covers ${what} — request a licence before review`;
}

/** Where an observation came from, for the user: partner + which analysis run. */
export function evidenceSource(e: Pick<Evidence, "source" | "analysisRun" | "origin">): string {
  if (e.source === "TWELVELABS") return analysisRunLabel(e.analysisRun);
  return e.source === "HUMAN" ? "Reviewer observation" : "ScorePlay data";
}

/** Before/after of a derived cut, in source seconds, with where each removal's evidence came from. */
export function timelineOf(edl: Edl, assetDurationSec?: number): EditTimeline {
  return {
    edlId: edl.id,
    sourceAssetId: edl.sourceAssetId,
    sourceTitle: edl.sourceTitle,
    ...(assetDurationSec ? { assetDurationSec } : {}),
    original: edl.sourceRange,
    removed: edl.removed.map((r) => ({
      start: r.start,
      end: r.end,
      why: r.reason,
      source: [...new Set(r.evidence.map(evidenceSource))].join(" + ") || "Edit rule (leftover too short)",
    })),
    retained: edl.retained,
    output: edl.timeline,
    resultDurationSec: edl.durationSec,
    originalDurationSec: edl.originalDurationSec,
    execution: edl.execution,
    executionLabel: EDL_EXECUTION_LABEL,
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

/** "A, B and C". */
const andList = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : (xs[0] ?? ""));

/** Who a `subject:<label>` reason is about: the name the observation used, else the label in words. */
export function subjectName(r: Pick<Reason, "ruleId">, evidence: readonly Evidence[]): string {
  const label = r.ruleId.slice("subject:".length);
  const seen = evidence.find((e) => e.label && normalizeLabel(e.label) === label);
  const fromSeen = seen?.observation.split(":")[0]?.trim();
  if (fromSeen) return fromSeen;
  return label
    .slice(label.indexOf(":") + 1)
    .split("-")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/** One line for several people named only by AI: an unconfirmed identification, never "no image rights". */
export function unverifiedPeopleText(names: readonly string[]): string {
  const unique = [...new Set(names)];
  return unique.length === 1
    ? `AI named ${unique[0]}; ScorePlay identity data can't confirm it — a reviewer must verify who it is.`
    : `${unique.length} people named by AI couldn't be verified against ScorePlay: ${andList(unique)} — a reviewer must verify who they are.`;
}

/**
 * REROUTE reasons as plain-English topics: dimensions REROUTE explained with the same sentence are
 * one topic (e.g. all licence terms), and each topic lists REROUTE's explanations verbatim — except several people
 * named only by AI, who share one sentence (`evidence` names them).
 */
export function rightsIssues(
  reasons: readonly (Pick<Reason, "dimension" | "outcome" | "explanation"> & Partial<Pick<Reason, "ruleId" | "basis">>)[],
  evidence: readonly Evidence[] = [],
): RightsIssue[] {
  const unverified = reasons.filter((r) => r.outcome !== "PERMIT" && r.ruleId !== undefined && isUnverifiedPerson({ ruleId: r.ruleId, basis: r.basis }));
  const people = new Set(unverified.map((r) => r.ruleId!));
  const merged =
    people.size > 1
      ? [
          ...reasons.filter((r) => !unverified.includes(r)),
          { dimension: "people", outcome: "MISSING" as const, explanation: unverifiedPeopleText([...people].map((ruleId) => subjectName({ ruleId }, evidence))) },
        ]
      : reasons;
  const byExplanation = new Map<string, { outcome: "DENY" | "MISSING"; dimensions: string[] }>();
  for (const r of merged) {
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

/**
 * Brand labels a sponsor reason is about: its own subject, the target sponsor, or the brands the restriction rule
 * names (so a partner logo seen in the same seconds is never shown as the conflict). Undefined = not a sponsor reason.
 */
function sponsorLabels(r: Partial<Pick<Reason, "ruleId">> & Pick<Reason, "dimension">, sponsorship?: Sponsorship): Set<string> | undefined {
  if (r.dimension.toLowerCase() !== "sponsor" || !sponsorship || !r.ruleId) return undefined;
  const id = r.ruleId;
  if (id.startsWith("subject:")) return new Set([id.slice("subject:".length)]);
  if (id.startsWith(CLUB_PARTNER_RULE_PREFIX)) return new Set([`brand:${id.slice(CLUB_PARTNER_RULE_PREFIX.length)}`]);
  const brands = id.startsWith(TARGET_SPONSOR_RULE_PREFIX)
    ? sponsorship.brands.filter((b) => b.role === "TARGET")
    : sponsorship.brands.filter((b) => b.ruleId === id && b.role === "COMPETING_RESTRICTED");
  return new Set(brands.map((b) => b.label));
}

/** Evidence labels that can back a reason, per dimension (labels set by the TwelveLabs parser / reviewers). */
const EVIDENCE_PREFIX: Record<string, string> = { sponsor: "brand:", people: "person:" };
const secs = (n: number) => `${Math.round(n * 10) / 10}`;

/**
 * Splits one REROUTE reason into REAL evidence ("what we found", with provenance) and the RULE applied
 * (REROUTE's explanation verbatim, tagged fictional or verified). Wording is never parsed: findings come
 * from the decision's evidence, else from where the reason's basis says the fact came from.
 */
export function reasonFinding(
  r: Pick<Reason, "dimension" | "outcome" | "explanation"> & Partial<Pick<Reason, "ruleId" | "basis" | "scoreplayMediaId" | "start" | "end">>,
  ctx: { evidence?: readonly Evidence[]; fictional: boolean; plannedUse?: string; sponsorship?: Sponsorship },
): ReasonFinding | null {
  if (r.outcome === "PERMIT") return null;
  const prefix = EVIDENCE_PREFIX[r.dimension.toLowerCase()];
  const brands = sponsorLabels(r, ctx.sponsorship);
  const inSpan = prefix
    ? (ctx.evidence ?? []).filter(
        (e) =>
          e.label?.toLowerCase().startsWith(prefix) &&
          (!brands || brands.has(normalizeLabel(e.label))) &&
          (!r.scoreplayMediaId || e.scoreplayMediaId === r.scoreplayMediaId) &&
          (r.start === undefined || r.end === undefined || e.start === undefined || ((e.end ?? e.start) >= r.start && e.start <= r.end)),
      )
    : [];
  // A per-subject reason is backed by that subject's own observation when there is one.
  const own = r.ruleId?.startsWith("subject:") ? inSpan.filter((e) => normalizeLabel(e.label!) === r.ruleId!.slice("subject:".length)) : [];
  const seen = own.length ? own : inSpan;
  const found = seen.length
    ? [...new Map(seen.map((e) => [`${e.source}|${e.analysisRun}|${e.observation}|${e.start}|${e.end}`, e])).values()].map((e) => ({
        text: e.start === undefined ? e.observation : `${e.observation} (${secs(e.start)}–${secs(e.end ?? e.start)} s)`,
        source: evidenceSource(e),
      }))
    : [fallbackFinding(r, ctx.plannedUse, ctx.sponsorship)];
  return {
    dimension: r.dimension,
    outcome: r.outcome,
    found,
    rule: { id: r.ruleId, text: r.explanation, tag: ctx.fictional ? "Demo policy · fictional" : "Verified policy" },
  };
}

function fallbackFinding(
  r: Pick<Reason, "dimension"> & Partial<Pick<Reason, "basis" | "scoreplayMediaId" | "ruleId">>,
  plannedUse?: string,
  sponsorship?: Sponsorship,
): ReasonFinding["found"][number] {
  const asset = r.scoreplayMediaId ? ` (asset ${r.scoreplayMediaId})` : "";
  if (r.ruleId?.startsWith(TARGET_SPONSOR_RULE_PREFIX)) {
    return { text: `Your goal names ${sponsorship?.target?.name ?? "a partner"} as the partner this post promotes.`, source: "Your goal" };
  }
  if (r.basis === "TECHNICAL_OBSERVATION") return { text: `No video analysis is available for this clip${asset}.`, source: "Video analysis · TwelveLabs" };
  if (r.basis === "MEDIA_IDENTITY") return { text: `This clip${asset} could not be matched to exactly one analysed video.`, source: "ScorePlay ↔ TwelveLabs link" };
  if (LICENCE[r.dimension.toLowerCase()]) return { text: plannedUse ? `Planned use: ${plannedUse}.` : "The campaign's planned channel, country, use and date.", source: "Your campaign plan" };
  return { text: `What ScorePlay records about this clip${asset}.`, source: "ScorePlay data" };
}

/**
 * Every non-permitting reason of one decision as a finding; several people named only by AI become ONE finding
 * ("4 people named by AI couldn't be verified…") whose observations still list each person.
 */
export function decisionFindings(d: Decision, plannedUse?: string): ReasonFinding[] {
  const ctx = { evidence: d.evidence, fictional: d.policyFictional, plannedUse, sponsorship: d.sponsorship };
  const people = d.reasons.filter((r) => r.outcome !== "PERMIT" && isUnverifiedPerson(r));
  if (people.length < 2) return d.reasons.flatMap((r) => reasonFinding(r, ctx) ?? []);
  const each = people.flatMap((r) => reasonFinding(r, ctx) ?? []);
  return [
    ...d.reasons.filter((r) => !people.includes(r)).flatMap((r) => reasonFinding(r, ctx) ?? []),
    {
      dimension: "people",
      outcome: "MISSING",
      found: [...new Map(each.flatMap((f) => f.found).map((f) => [`${f.text}|${f.source}`, f])).values()],
      rule: {
        id: "identity:unverified-people",
        text: unverifiedPeopleText(people.map((r) => subjectName(r, d.evidence))),
        tag: d.policyFictional ? "Demo policy · fictional" : "Verified policy",
      },
    },
  ];
}

/** "all 3 planned uses (Instagram, Facebook, X · GB · commercial)": the uses a re-check actually covered. */
export function plannedUsesLabel(intents: readonly Pick<PublishIntent, "platform" | "territory" | "usage">[]): string {
  const uniq = (xs: string[]) => [...new Set(xs)];
  const parts = [
    uniq(intents.map((i) => PLATFORM[i.platform.toLowerCase()] ?? i.platform)).join(", "),
    uniq(intents.map((i) => i.territory)).join(", "),
    uniq(intents.map((i) => i.usage.toLowerCase())).join(", "),
  ];
  const n = intents.length;
  return `${n === 1 ? "the planned use" : `all ${n} planned uses`} (${parts.join(" · ")})`;
}

export const isDemo = (d: Pick<Decision, "policyFictional" | "clearance">) => d.policyFictional || d.clearance === "DEMO";

/** Plain-language topic of one REROUTE reason dimension (same wording as `rightsIssues`). */
export const reasonTopic = (dimension: string) => TOPIC[dimension] ?? TOPIC[dimension.toLowerCase()] ?? dimension;

/**
 * Identity of the inputs a selection-time preflight of `rec` uses (server/preflight.ts): run, moment, rule package,
 * usage, territories, channels and cut (the campaign's derived cut only for the moment the campaign uses). Pure and
 * shared by the view and the endpoint, so a result is shown only while it still describes the card's inputs.
 */
export function preflightBasis(run: Pick<GoalRun, "id" | "policy" | "plan" | "campaign">, rec: Pick<Recommendation, "key">): string {
  const plan = run.campaign?.plan ?? run.plan;
  const policy = run.policy ? `${run.policy.packageId}@${run.policy.version}` : "club-default";
  const cut = run.campaign?.key === rec.key && run.campaign.edl ? run.campaign.edl.id : "moment";
  return [run.id, rec.key, policy, plan.usage, [...plan.territories].sort().join(","), [...plan.channels].sort().join(","), cut].join("|");
}

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
    issues: rightsIssues(d.reasons, d.evidence),
    findings: decisionFindings(d, describeUse(intent)),
    missingFacts: d.missingFacts,
  };
}

/** The latest evaluation of the campaign's current moment (any version), if REROUTE evaluated it. */
export function latestEvaluation(run: GoalRun): GoalEvaluation | undefined {
  const c = run.campaign;
  return c ? run.evaluations.findLast((e) => e.campaignId === c.campaignId && e.key === c.key) : undefined;
}

/** Whether `e` was decided under the run's current rule package (a package switch makes the verdict stale). */
export function underRunPolicy(run: Pick<GoalRun, "policy">, e: Pick<GoalEvaluation, "policy">): boolean {
  return !run.policy || !e.policy || (e.policy.packageId === run.policy.packageId && e.policy.version === run.policy.version);
}

export function presentRights(run: GoalRun): RightsView {
  const e = latestEvaluation(run);
  if (!e) {
    return {
      state: "NOT_CHECKED",
      headline: "Not checked yet",
      detail: "This proposal hasn't been checked yet. Nothing is cleared until it is.",
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
  const issues = rightsIssues(
    e.perIntent.flatMap((p) => p.decision.reasons),
    e.perIntent.flatMap((p) => p.decision.evidence),
  );
  const copy: Record<Decision["verdict"], { headline: string; detail: string }> = {
    ALLOWED: demo
      ? { headline: "Allowed under a demo policy", detail: `${DEMO_CLEARANCE_LABEL}. ${tally} This can go to review for the demo, but it can never authorize publication.` }
      : { headline: "Cleared for every planned use", detail: `${tally} Policy ${d.policyId} v${d.policyVersion}.` },
    NEEDS_REVIEW: { headline: "Needs a rights review", detail: `Some uses aren't covered yet. ${tally} A person must review it — or find another way.` },
    BLOCKED: { headline: "Restricted for at least one planned use", detail: `This clip can't be used for this campaign as planned. ${tally} Find another way to reach the same goal.` },
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
    current: e.campaignVersion === run.campaign?.version && underRunPolicy(run, e),
    perIntent,
    issues,
    missingFacts: [...new Set(e.perIntent.flatMap((p) => p.decision.missingFacts))],
  };
}

function recommendationView(run: GoalRun, rec: Recommendation, previews: ReadonlyMap<string, Preview>, unavailable: string): RecommendationView {
  const e = run.evaluations.findLast((x) => x.key === rec.key);
  const shown = withPreview(rec, previews.get(rec.key), unavailable);
  return {
    ...shown,
    rights: e ? { state: e.overall.verdict, clearance: e.overall.clearance } : { state: "NOT_CHECKED" },
    preflightBasis: preflightBasis(run, rec),
  };
}

/**
 * Sponsored/sales plans: the partner the goal promotes and every brand the latest check saw, as the sponsor rules
 * treat them (merged across uses). Target null = no partner named — the rules applied literally.
 */
function sponsorContextOf(plan: GoalRun["plan"], e: GoalEvaluation): Sponsorship | undefined {
  if (plan.usage !== "SPONSORED" && plan.usage !== "COMMERCIAL") return undefined;
  const all = e.perIntent.flatMap((p) => (p.intent.usage === plan.usage && p.decision.sponsorship ? [p.decision.sponsorship] : []));
  const brands = new Map<string, Sponsorship["brands"][number]>();
  for (const b of all.flatMap((s) => s.brands)) {
    const prev = brands.get(b.label);
    brands.set(b.label, prev ? { ...prev, spans: [...new Set([...prev.spans, ...b.spans])] } : b);
  }
  return { target: all.find((s) => s.target)?.target ?? null, brands: [...brands.values()] };
}

const PREVIEW_UNAVAILABLE = "No browser-playable stream is available for this video.";

/** The review receipt for the current campaign version, if one was submitted. */
type Receipt = Pick<RightsReceipt, "id" | "decision" | "humanReviewStatus" | "writeback">;

/** "N of M uses allowed" counts of one evaluation. */
const usesOf = (e: GoalEvaluation) => ({ allowedUses: e.perIntent.filter((p) => p.decision.verdict === "ALLOWED").length, totalUses: e.perIntent.length });

/**
 * A stored recovery option as the Compliance Editor shows it: the view schema drops what only `applyRecovery`
 * needs (EDL internals, intents, segment, media refs); a cut becomes its before/after timeline.
 */
export function recoveryOptionView(o: StoredRecoveryOption, assetDurationSec?: number): RecoveryOption {
  return RecoveryOptionSchema.parse({
    ...o,
    ...(o.relevance ? { summary: `${o.summary} ${o.relevance}` } : {}),
    ...(o.edl ? { timeline: timelineOf(o.edl, assetDurationSec) } : {}),
  });
}

/** The recovery plan of the latest evaluation of the current version, as the Compliance Editor shows it. */
function recoveryView(run: GoalRun, latest: GoalEvaluation | undefined, current: boolean): RecoveryView | undefined {
  if (!latest || !current) return undefined;
  const found = run.recoveries.findLast((r) => r.forEvaluationId === latest.id && r.forKey === latest.key);
  if (!found) return undefined;
  const assetDuration = run.campaign?.mediaRef.match?.scoreplayDurationSec;
  return {
    id: found.id,
    forEvaluationId: found.forEvaluationId,
    generatedAt: found.generatedAt,
    scope: found.scope,
    problem: { headline: found.headline, items: found.problems },
    options: found.options.map((o) => recoveryOptionView(o, assetDuration)),
    ...(found.recommendedId ? { recommendedId: found.recommendedId } : {}),
    ...(found.noPathMessage ? { noPathMessage: found.noPathMessage } : {}),
  };
}

const titleOfKey = (run: GoalRun, key: string) => [...run.pool, ...run.adopted].find((r) => r.key === key)?.candidate.title ?? key;

/** The last applied recovery and REROUTE's verdict before (the evaluation it fixed) and after (its version's check). */
function beforeAfterView(run: GoalRun): BeforeAfter | undefined {
  const last = run.applied.at(-1);
  const before = last && run.evaluations.find((e) => e.id === last.fromEvaluationId);
  if (!last || !before || run.campaign?.campaignId !== before.campaignId) return undefined;
  const after = run.evaluations.findLast((e) => e.campaignId === before.campaignId && e.campaignVersion === last.campaignVersion);
  const edl = run.campaign?.version === last.campaignVersion ? run.campaign.edl : undefined;
  return {
    optionId: last.optionId,
    kind: last.kind,
    title: last.title,
    before: { evaluationId: before.id, verdict: before.overall.verdict, ...usesOf(before), key: before.key, title: titleOfKey(run, before.key) },
    ...(after ? { after: { evaluationId: after.id, verdict: after.overall.verdict, clearance: after.overall.clearance, ...usesOf(after), key: after.key, title: titleOfKey(run, after.key) } } : {}),
    ...(edl ? { timeline: timelineOf(edl, run.campaign?.mediaRef.match?.scoreplayDurationSec) } : {}),
  };
}

function nextStep(
  run: GoalRun,
  rights: RightsView,
  review: ReviewStatus,
  canSubmit: boolean,
  publishable: boolean,
  recovery: RecoveryView | undefined,
  gap: GoalEvaluation["licenceGap"],
): string {
  if (!run.campaign) return run.pool.length ? "Pick one of the three moments to build its campaign." : "No usable moment was found — refine the goal or index more footage.";
  if (run.campaign.cta.status === "NOT_CONFIGURED" && review === "NOT_SUBMITTED" && rights.state === "NOT_CHECKED") {
    const link = run.objective.product && PRODUCTS[run.objective.product.key].commerce === "ticketing" ? "ticketing link" : "store link";
    return `Check rights for every planned channel and country. The ${link} isn't set yet — you can add the club's https link now or later.`;
  }
  if (rights.state === "NOT_CHECKED" || !rights.current) return "Check rights for every planned channel and country.";
  if (review === "APPROVED")
    return publishable
      ? "Approved with verified clearance — ready to publish in the club's own tool, then record it back in ScorePlay."
      : `Approved by a reviewer. Publishing stays locked: ${rights.clearanceLabel ? "the decision was made under illustrative rules" : "the clearance is not verified"}. The ScorePlay record is a dry run.`;
  if (review === "REJECTED") return "The reviewer rejected this version. Find a way to use it or change the proposal, then submit again.";
  if (review === "PENDING") return "Waiting for a reviewer to approve or reject.";
  if (gap) return `${noLicenceReason(gap)}. Request a licence — we won't move your campaign to other markets.`;
  if (recovery?.recommendedId) return "Review the suggested correction: each option was re-checked on its own. Use the revised plan, or send it for human review.";
  if (recovery?.noPathMessage) return recovery.noPathMessage;
  if (rights.state === "BLOCKED") return "This clip can't be used as planned. Find a way to use it — PULSE locates the problem, proposes the smallest fix and re-checks it.";
  if (canSubmit)
    return rights.state === "NEEDS_REVIEW"
      ? "Submit for human review — or find a way to use it first."
      : "Submit for human review to create the audit receipt.";
  return "Check rights again.";
}

export function buildGoalView(
  run: GoalRun,
  /** `previewUnavailable`: the note shown instead of a player (defaults to "no playable stream"). */
  opts: { version: number; receipt?: Receipt | null; previews?: ReadonlyMap<string, Preview>; previewUnavailable?: string },
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

  const recovery = recoveryView(run, latest, rights.current);
  const sponsorContext = rights.current && latest ? sponsorContextOf(draft?.plan ?? run.plan, latest) : undefined;
  // A reviewer cannot grant a missing licence: a licence gap is never submittable.
  const gap = rights.current ? latest?.licenceGap : undefined;
  const canSubmit = !!latest && rights.current && latest.overall.verdict !== "BLOCKED" && !submitted && !gap;
  const kpi = goalKpi(run.objective);

  // A recovery may turn a sales post into an organic one: then no store/ticketing items apply.
  const commerce = draft?.plan.usage === "COMMERCIAL" && run.objective.product && PRODUCTS[run.objective.product.key].commerce;
  const notLocalized = draft?.evidenceLabels.find((l) => l.startsWith("Copy not localized"));
  const campaign = draft && {
    ...draft,
    checklist: [
      draft.edl
        ? {
            item: "Media and exact timestamps",
            status: "DONE" as const,
            note: `Edited cut of ScorePlay asset ${draft.edl.sourceAssetId}: ${draft.edl.retained.length} kept part(s), ${draft.edl.durationSec} s. ${EDL_EXECUTION_LABEL}.`,
          }
        : { item: "Media and exact timestamps", status: "DONE" as const, note: `TwelveLabs moment on ScorePlay asset ${draft.mediaRef.scoreplayMediaId} (${draft.mediaRef.method}).` },
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
              note: run.objective.targetSponsor
                ? `Your goal names ${run.objective.targetSponsor} as the partner to promote: add its credit exactly as contracted. PULSE writes no partner claim — whether these rules describe ${run.objective.targetSponsor} as a partner is shown in the rights check.`
                : "No partner is named in the goal: add the partner credit exactly as contracted. PULSE never picks a sponsor — the rights check applies the brand rules as written.",
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

  const view = (r: Recommendation) => recommendationView(run, r, previews, opts.previewUnavailable ?? PREVIEW_UNAVAILABLE);
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
      playerFilter: run.playerFilter,
      intents: run.intents,
      library: run.library,
      search: run.search,
      attempts: run.attempts,
      selectedKey: run.selectedKey,
    },
    recommendations: pool.slice(0, 3).map(view),
    photos: run.photos ?? [],
    ...(run.photosNote ? { photosNote: run.photosNote } : {}),
    selected: selectedRec && view(selectedRec),
    campaign,
    rights,
    recovery,
    ...(sponsorContext ? { sponsorContext } : {}),
    ...(draft?.edl ? { edit: timelineOf(draft.edl, draft.mediaRef.match?.scoreplayDurationSec) } : {}),
    beforeAfter: beforeAfterView(run),
    ...(run.policy ? { policy: run.policy } : {}),
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
        ? "Decided under illustrative rules — publishing needs a verified club agreement, even after approval."
        : "Publishing needs a verified rights agreement and human approval.",
    nextStep: nextStep(run, rights, reviewStatus, canSubmit, publishable, recovery, gap),
    kpi,
    timing: { toRecommendationsSec: seconds(run.resultsAt), toProposalSec: run.proposalAt ? seconds(run.proposalAt) : undefined },
    dataOrigin: run.dataOrigin,
  };
}
