/**
 * Media Compliance Recovery Engine ("Find a way to use it"). Pure and deterministic.
 *
 * Given a restricted campaign use, it locates WHERE each restriction sits, proposes the smallest practical
 * changes and evaluates every one of them independently with the same rights engine:
 * - TRIM          remove the flagged source intervals (EDL; retained footage re-evaluated, never assumed clean)
 * - SAFE_SECTION  the best contiguous section of the same asset that carries no localized restriction
 * - REPLACE       another real moment (found by the server's search; evaluated here like any other edit)
 * - ADAPT_CAMPAIGN keep only the campaign's licensed territories/channels (restriction is in the plan, not the clip)
 * - CHANGE_USAGE  same footage as an organic post (flagged as changing the goal)
 * - REQUEST_CLEARANCE the honest next step when nothing executable resolves it
 *
 * Localization: the selected range is split at every observation boundary; each elementary interval is
 * evaluated on its own for every use. A clip-scoped restriction present in EVERY interval is pervasive (no cut
 * can remove it); one present only in some intervals is localized to them. A restriction in removed footage
 * disappears only if the engine says so when it re-evaluates the kept footage.
 */
import type { Asset, Clearance, EditDecision, EditPlan, Evidence, PublishIntent, Reason, Segment, Verdict } from "@/lib/contracts";
import { classifyBlocker, reasonScope } from "../blocker";
import { CLUB_PARTNER_RULE_PREFIX, evaluateEdit, isUnverifiedPerson, matchesPattern, normalizeLabel, TARGET_SPONSOR_RULE_PREFIX, worstVerdict, type AnalysisStatus } from "../engine";
import { clubPartnerOf } from "../club-partners";
import type { Policy } from "../policy";
import { buildEdl, edlToEditPlan, mergeIntervals, type Edl, type Interval, type Removal } from "./edl";
import { DEFAULT_LIMITS, type RecoveryLimits } from "./limits";

export const RECOVERY_KINDS = ["TRIM", "SAFE_SECTION", "REPLACE", "ADAPT_CAMPAIGN", "CHANGE_USAGE", "REQUEST_CLEARANCE"] as const;
export type RecoveryKind = (typeof RECOVERY_KINDS)[number];

/** RESOLVES_DEMO = re-check ALLOWED (all bundled/uploaded policies are demo: never legal clearance). */
export type RecoveryOutcome = "RESOLVES_DEMO" | "NEEDS_REVIEW" | "STILL_BLOCKED" | "NOT_VIABLE" | "NEXT_STEP";

export interface RecoveryEvalContext {
  assets: Record<string, Asset>;
  observations: Record<string, Evidence[]>;
  analysis: Record<string, AnalysisStatus>;
  policies: readonly Policy[];
  now: Date;
}

export interface UseDecision {
  intent: PublishIntent;
  decision: EditDecision;
}

export interface RecheckSummary {
  verdict: Verdict;
  clearance: Clearance;
  /** allowed + restricted + unresolved = total: an unknown is never counted as allowed. */
  allowedUses: number;
  /** Uses REROUTE blocked (a rule denies them). */
  restrictedUses: number;
  /** Uses that need a reviewer (something is unknown or unconfirmed). */
  unresolvedUses: number;
  totalUses: number;
  /** Unique non-PERMIT reasons across every use (empty when ALLOWED). */
  remaining: Reason[];
  /** Evidence the decisions used (names the subjects of `remaining`). */
  evidence: Evidence[];
  policyId: string;
  policyVersion: string;
  evaluatedAt: string;
}

export interface PlannedOption {
  id: string;
  kind: RecoveryKind;
  title: string;
  summary: string;
  tradeoff: string;
  changesGoal: boolean;
  outcome: RecoveryOutcome;
  notViableBecause?: string;
  /** TRIM / SAFE_SECTION: the derived cut. */
  edl?: Edl;
  /** What would be published (and re-evaluated when applied). */
  edit?: EditPlan;
  /** The uses the re-check covered (ADAPT_CAMPAIGN / CHANGE_USAGE change them). */
  intents?: PublishIntent[];
  recheck?: RecheckSummary;
  replacement?: { key: string; title: string; scoreplayMediaId: string; start: number; end: number; query: string; rank: number };
  campaignChange?: { territories?: string[]; dropped?: string[]; platforms?: string[]; usage?: PublishIntent["usage"] };
  /** Why the footage still fits the goal (SAFE_SECTION / REPLACE). */
  relevance?: string;
  /** SAFE_SECTION: how the section is tied to the goal (overlap with the chosen moment, or a search hit's rank). */
  tie?: { overlapsMoment: boolean; searchRank?: number };
}

export interface ProblemItem {
  scope: "CLIP" | "CAMPAIGN";
  /** Present in every part of the selected footage (a cut cannot remove it). */
  pervasive: boolean;
  text: string;
  ruleIds: string[];
  /** Source seconds of a localized restriction. */
  at?: Interval;
  evidence: Evidence[];
}

export interface RecoveryPlan {
  scope: "CLIP" | "CAMPAIGN" | "MIXED";
  headline: string;
  problems: ProblemItem[];
  current: RecheckSummary;
  /** No planned market (or channel) is licensed: no edit, replacement or change of use can pass. */
  licenceGap: boolean;
  options: PlannedOption[];
  recommendedId?: string;
  noPathMessage?: string;
}

export interface ReplacementInput {
  key: string;
  title: string;
  segment: Segment;
  query: string;
  rank: number;
  /** Independent decision of the replacement for every use. */
  evaluations: UseDecision[];
}

export interface PlanRecoveryInput {
  ctx: RecoveryEvalContext;
  /** The selected source moment: one asset, the selected range, and cuts already applied to it. */
  source: { assetId: string; title: string; range: Interval; priorRemovals?: Removal[] };
  intents: PublishIntent[];
  /** Replacement moments the server found and evaluated (REPLACE options). */
  replacements?: ReplacementInput[];
  /** Video-search hits for the moment's query inside the SOURCE asset (relevance evidence for SAFE_SECTION). */
  sourceHits?: { start: number; end: number; rank: number; query: string }[];
  /** Prefix for derived ids (edit plans / EDLs), e.g. the campaign id. */
  idPrefix: string;
  limits?: Partial<RecoveryLimits>;
}

// ---------- helpers ----------

const r3 = (t: number) => Math.round(t * 1000) / 1000;

/** "0:09.0" */
export function timecode(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

const span = (i: Interval) => `${timecode(i.start)}–${timecode(i.end)}`;
const secs = (t: number) => `${t.toFixed(1)} s`;
const unique = <T>(xs: readonly T[]) => [...new Set(xs)];
const CHANNEL_NAME: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X", tiktok: "TikTok", youtube: "YouTube" };
/** A use no rule licenses, as a rights holder reads it: merchandise advertising is a different right from a social post. */
export const UNLICENSED_USE: Record<string, string> = {
  COMMERCIAL: "commercial use (merchandise and sales posts)",
  SPONSORED: "sponsored posts",
  ORGANIC: "organic club posts",
  EDITORIAL: "editorial use",
};
const reasonKey = (r: Reason) => `${r.ruleId}|${r.dimension}|${r.outcome}`;
const entityOf = (ev: Evidence) => ev.observation.split(":")[0]?.trim() || ev.label || "an observation";
const timed = (ev: Evidence) => ev.start !== undefined || ev.end !== undefined;

function overlapsInterval(ev: Evidence, i: Interval): boolean {
  const s = ev.start ?? 0;
  const e = ev.end ?? Number.POSITIVE_INFINITY;
  return s === e ? s >= i.start && s < i.end : s < i.end && e > i.start;
}

const segmentEdit = (id: string, title: string, segments: Segment[], derivedFrom?: string): EditPlan => ({
  id,
  title,
  segments,
  derived: true,
  ...(derivedFrom ? { derivedFrom } : {}),
});

/** One edit under every use. */
export function evaluateUses(ctx: RecoveryEvalContext, edit: EditPlan, intents: readonly PublishIntent[]): UseDecision[] {
  return intents.map((intent) => ({
    intent,
    decision: evaluateEdit({ edit, assets: ctx.assets, observations: ctx.observations, analysis: ctx.analysis, intent, now: ctx.now, policies: ctx.policies }),
  }));
}

/** Verdict over every use + what still stands in the way. */
export function summarizeUses(uses: readonly UseDecision[]): RecheckSummary {
  const verdict = worstVerdict(uses.map((u) => u.decision.decision.verdict));
  const clearances = uses.map((u) => u.decision.decision.clearance);
  const clearance: Clearance = verdict !== "ALLOWED" ? "NONE" : clearances.every((c) => c === "VERIFIED") ? "VERIFIED" : "DEMO";
  const remaining = new Map<string, Reason>();
  for (const u of uses) for (const r of u.decision.decision.reasons) if (r.outcome !== "PERMIT" && !remaining.has(reasonKey(r))) remaining.set(reasonKey(r), r);
  const first = uses[0]?.decision.decision;
  const count = (v: Verdict) => uses.filter((u) => u.decision.decision.verdict === v).length;
  return {
    verdict,
    clearance,
    allowedUses: count("ALLOWED"),
    restrictedUses: count("BLOCKED"),
    unresolvedUses: count("NEEDS_REVIEW"),
    totalUses: uses.length,
    remaining: [...remaining.values()],
    evidence: unique(uses.flatMap((u) => u.decision.decision.evidence)),
    policyId: unique(uses.map((u) => u.decision.decision.policyId)).join("+") || "none",
    policyVersion: unique(uses.map((u) => u.decision.decision.policyVersion)).join("+") || "none",
    evaluatedAt: first?.evaluatedAt ?? new Date(0).toISOString(),
  };
}

const outcomeOf = (v: Verdict): RecoveryOutcome => (v === "ALLOWED" ? "RESOLVES_DEMO" : v === "NEEDS_REVIEW" ? "NEEDS_REVIEW" : "STILL_BLOCKED");

/** A re-check that still blocks says why (the editor lists it as rejected, never as a fix). */
const stillBlocked = (recheck: RecheckSummary) =>
  recheck.verdict === "BLOCKED" ? { notViableBecause: `Still restricted after this change: ${recheck.remaining.filter((r) => r.outcome === "DENY").map((r) => r.explanation).slice(0, 2).join(" ")}` } : {};

// ---------- localization ----------

export interface LocalizedProblem extends Interval {
  ruleIds: string[];
  /** Plain-language reason per restriction (rule explanation or subject reason). */
  explanations: string[];
  /** The engine's reasons placed here (one per rule/subject). */
  reasons: Reason[];
  evidence: Evidence[];
}

export interface Localization {
  localized: LocalizedProblem[];
  /** Clip-scoped restrictions present in every part of the footage. */
  pervasive: Reason[];
  /** Restrictions tied to the planned use (territory, platform, usage, date, policy). */
  campaign: { reason: Reason; intents: PublishIntent[] }[];
}

/** Evidence that places restriction `r` inside `piece`. */
function triggeringEvidence(r: Reason, piece: Interval, evidence: readonly Evidence[], policies: readonly Policy[]): Evidence[] {
  const inPiece = evidence.filter((ev) => timed(ev) && overlapsInterval(ev, piece));
  if (r.ruleId.startsWith("subject:")) {
    const label = r.ruleId.slice("subject:".length);
    const hit = inPiece.filter((ev) => ev.label && normalizeLabel(ev.label) === label);
    if (hit.length) return hit;
  }
  const rule = policies.flatMap((p) => p.rules).find((x) => x.id === r.ruleId);
  const labels = rule?.match.evidenceLabels;
  if (labels) {
    const except = rule.match.evidenceLabelsExcept ?? [];
    const hit = inPiece.filter((ev) => ev.label && labels.some((p) => matchesPattern(ev.label!, p)) && !except.some((p) => matchesPattern(ev.label!, p)));
    if (hit.length) return hit;
  }
  return [];
}

function ruleExplanation(r: Reason, policies: readonly Policy[]): string {
  if (r.ruleId.startsWith("subject:")) return r.explanation;
  return policies.flatMap((p) => p.rules).find((x) => x.id === r.ruleId)?.explanation ?? r.explanation;
}

/**
 * Where each restriction of `assetId` sits inside `intervals` (source seconds), for every use. Pure: every
 * elementary interval (between consecutive observation boundaries) is evaluated by the rights engine.
 */
export function locateProblems(ctx: RecoveryEvalContext, assetId: string, intervals: readonly Interval[], intents: readonly PublishIntent[]): Localization {
  const evidence = ctx.observations[assetId] ?? [];
  const pieces: Interval[] = [];
  for (const iv of intervals) {
    const cuts = unique(
      [iv.start, iv.end, ...evidence.filter(timed).flatMap((ev) => [ev.start ?? iv.start, ev.end ?? iv.end])].filter((t) => t >= iv.start && t <= iv.end).map(r3),
    ).sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) if (cuts[i + 1] - cuts[i] > 1e-3) pieces.push({ start: cuts[i], end: cuts[i + 1] });
  }

  type PieceResult = { piece: Interval; clip: Map<string, Reason> };
  const results: PieceResult[] = [];
  const campaign = new Map<string, { reason: Reason; intents: PublishIntent[] }>();
  for (const piece of pieces) {
    const edit = segmentEdit("probe", "probe", [{ scoreplayMediaId: assetId, start: piece.start, end: piece.end }]);
    const clip = new Map<string, Reason>();
    for (const use of evaluateUses(ctx, edit, intents)) {
      for (const r of use.decision.decision.reasons) {
        if (r.outcome === "PERMIT") continue;
        if (reasonScope(r, ctx.policies) === "CAMPAIGN") {
          const entry = campaign.get(reasonKey(r)) ?? { reason: r, intents: [] };
          if (!entry.intents.includes(use.intent)) entry.intents.push(use.intent);
          campaign.set(reasonKey(r), entry);
        } else if (!clip.has(reasonKey(r))) clip.set(reasonKey(r), r);
      }
    }
    results.push({ piece, clip });
  }

  // Pervasive = present in every piece AND not placed by any timed observation (an asset fact or rule). A restriction
  // whose observation merely spans the whole selection is still localized in the asset (a clean section may exist).
  const placed = (k: string) => results.some((p) => p.clip.has(k) && triggeringEvidence(p.clip.get(k)!, p.piece, evidence, ctx.policies).length > 0);
  const everywhere = results.length ? [...results[0].clip.keys()].filter((k) => results.every((p) => p.clip.has(k)) && !placed(k)) : [];
  const pervasive = everywhere.map((k) => results[0].clip.get(k)!);

  const dirty: LocalizedProblem[] = [];
  for (const { piece, clip } of results) {
    const local = [...clip.entries()].filter(([k]) => !everywhere.includes(k)).map(([, r]) => r);
    if (local.length === 0) continue;
    dirty.push({
      ...piece,
      ruleIds: unique(local.map((r) => r.ruleId)),
      explanations: unique(local.map((r) => ruleExplanation(r, ctx.policies))),
      reasons: local,
      evidence: unique(local.flatMap((r) => triggeringEvidence(r, piece, evidence, ctx.policies))),
    });
  }
  // Adjacent dirty pieces form one localized problem.
  const localized: LocalizedProblem[] = [];
  for (const d of dirty) {
    const last = localized[localized.length - 1];
    if (last && d.start <= last.end + 1e-3) {
      last.end = Math.max(last.end, d.end);
      last.ruleIds = unique([...last.ruleIds, ...d.ruleIds]);
      last.explanations = unique([...last.explanations, ...d.explanations]);
      last.reasons = [...last.reasons, ...d.reasons.filter((r) => !last.reasons.some((x) => reasonKey(x) === reasonKey(r)))];
      last.evidence = unique([...last.evidence, ...d.evidence]);
    } else localized.push({ ...d });
  }
  return { localized, pervasive, campaign: [...campaign.values()] };
}

/** "Player #18", "Richarlison, Porro and the Kraken logo": what a localized problem shows, by kind. */
const whatIsThere = (p: Pick<LocalizedProblem, "evidence">) => {
  const kind = (ev: Evidence) => (ev.label ? normalizeLabel(ev.label).split(":")[0] : "");
  const people = unique(p.evidence.filter((e) => kind(e) === "person").map(entityOf));
  const brands = unique(p.evidence.filter((e) => kind(e) === "brand").map((e) => `the ${entityOf(e)} logo`));
  const other = unique(p.evidence.filter((e) => kind(e) !== "person" && kind(e) !== "brand").map(entityOf));
  const names = [...people, ...brands, ...other];
  return names.length ? (names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0]) : "restricted content";
};

/**
 * Why a localized problem matters, in one short sentence per kind: people named only by AI are an unconfirmed
 * identification (never "no image rights"), several of them share one sentence.
 */
function whyItMatters(p: LocalizedProblem, policies: readonly Policy[]): string {
  const rules = unique(p.ruleIds.filter((id) => !id.startsWith("subject:")).map((id) => policies.flatMap((x) => x.rules).find((r) => r.id === id)?.explanation ?? ""));
  const unverified = p.reasons.filter(isUnverifiedPerson).length;
  const unlisted = p.reasons.filter((r) => r.ruleId.startsWith("subject:person:") && !isUnverifiedPerson(r)).length;
  const parts = [
    ...rules.filter(Boolean),
    p.ruleIds.some((id) => id.startsWith("subject:brand:")) ? "No rule in this package covers this brand — a reviewer must confirm." : "",
    unverified
      ? `${unverified > 1 ? `${unverified} people named by AI couldn't` : "The person named by AI couldn't"} be verified against ScorePlay identity data — a reviewer must verify who ${unverified > 1 ? "they are" : "it is"}.`
      : "",
    unlisted ? `ScorePlay doesn't confirm ${unlisted > 1 ? "they are" : "this person is"} in the club's registered squad, so image rights can't be confirmed — a reviewer must verify.` : "",
  ];
  return parts.filter(Boolean).join(" ") || p.explanations.join(" ");
}

function removalsFor(problems: readonly LocalizedProblem[], range: Interval, margin: number, policies: readonly Policy[]): Removal[] {
  return problems.map((p) => ({
    start: r3(Math.max(range.start, p.start - margin)),
    end: r3(Math.min(range.end, p.end + margin)),
    reason: `${whatIsThere(p)} — ${whyItMatters(p, policies)}`,
    ruleIds: p.ruleIds,
    evidence: p.evidence,
  }));
}

// ---------- the planner ----------

export function planRecovery(input: PlanRecoveryInput): RecoveryPlan {
  const { ctx, source, intents, idPrefix } = input;
  const limits = { ...DEFAULT_LIMITS, ...input.limits };
  const asset = ctx.assets[source.assetId];
  const prior = source.priorRemovals ?? [];
  const keptNow = mergeIntervals(
    prior.length
      ? (buildEdl({ id: "x", sourceAssetId: source.assetId, sourceTitle: source.title, range: source.range, removals: prior, minPieceSec: 0 })?.retained ?? [])
      : [source.range],
  );
  const currentEdit = segmentEdit(`${idPrefix}:current`, source.title, keptNow.map((k) => ({ scoreplayMediaId: source.assetId, ...k })));
  const currentUses = evaluateUses(ctx, currentEdit, intents);
  const current = summarizeUses(currentUses);
  const where = locateProblems(ctx, source.assetId, keptNow, intents);

  const problems: ProblemItem[] = [
    ...where.localized.map((p) => ({
      scope: "CLIP" as const,
      pervasive: false,
      text: `${whatIsThere(p).replace(/^./, (c) => c.toUpperCase())} at ${span(p)} — ${whyItMatters(p, ctx.policies)}`,
      ruleIds: p.ruleIds,
      at: { start: p.start, end: p.end },
      evidence: p.evidence,
    })),
    ...where.pervasive.map((r) => ({ scope: "CLIP" as const, pervasive: true, text: r.explanation, ruleIds: [r.ruleId], evidence: [] })),
    // One unmatched licence rule fails on several dimensions with the same explanation: list it once.
    ...unique(where.campaign.map(({ reason }) => reason.explanation)).map((text) => ({
      scope: "CAMPAIGN" as const,
      pervasive: true,
      text,
      ruleIds: unique(where.campaign.filter(({ reason }) => reason.explanation === text).map(({ reason }) => reason.ruleId)),
      evidence: [],
    })),
  ];
  const clipProblems = where.localized.length + where.pervasive.length;
  const scope: RecoveryPlan["scope"] = clipProblems && where.campaign.length ? "MIXED" : where.campaign.length ? "CAMPAIGN" : "CLIP";
  // A territory, channel or use is unlicensed only when EVERY planned use with it fails on it: an unlicensed channel also
  // leaves its territory unmatched ("US" on Facebook), which must not read as "US isn't licensed" when Instagram/US is.
  const failsEverywhere = (dimension: "territory" | "platform" | "usage", value: string, pick: (i: PublishIntent) => string) =>
    currentUses.filter((u) => pick(u.intent) === value).every((u) => u.decision.decision.reasons.some((r) => r.dimension === dimension && r.outcome !== "PERMIT"));
  const unlicensedIn = (dimension: "territory" | "platform" | "usage", pick: (i: PublishIntent) => string) =>
    unique(where.campaign.flatMap((c) => (c.reason.dimension === dimension ? c.intents.map(pick) : []))).filter((v) => failsEverywhere(dimension, v, pick));
  const unlicensedPlatforms = unlicensedIn("platform", (i) => i.platform).map((p) => CHANNEL_NAME[p] ?? p);
  const unlicensedUses = unlicensedIn("usage", (i) => i.usage);
  const unlicensed = [...unlicensedUses.map((u) => UNLICENSED_USE[u] ?? u), ...unlicensedIn("territory", (i) => i.territory.toUpperCase()), ...unlicensedPlatforms];
  // Whether the plan's target sponsor is a partner — or a club partner on screen may appear — is a question for a
  // reviewer, not a missing licence and not a restriction a cut or another clip should "fix".
  const isReviewerQuestion = (r: Reason) => r.ruleId.startsWith(TARGET_SPONSOR_RULE_PREFIX) || r.ruleId.startsWith(CLUB_PARTNER_RULE_PREFIX);
  const licensing = where.campaign.filter((c) => !isReviewerQuestion(c.reason));
  const target = where.campaign.some((c) => c.reason.ruleId.startsWith(TARGET_SPONSOR_RULE_PREFIX)) ? intents.find((i) => i.targetSponsor)?.targetSponsor : undefined;
  const club = intents.find((i) => i.club)?.club ?? "";
  const clubPartners = unique(
    where.campaign
      .filter((c) => c.reason.ruleId.startsWith(CLUB_PARTNER_RULE_PREFIX))
      .map(({ reason: r }) => {
        const slug = r.ruleId.slice(CLUB_PARTNER_RULE_PREFIX.length);
        return `${clubPartnerOf(club, `brand:${slug}`)?.name ?? slug} (${span({ start: r.start ?? source.range.start, end: r.end ?? source.range.end })})`;
      }),
  );
  const inFootage = [
    ...where.localized.map((p) => `${whatIsThere(p)} (${span(p)})`),
    ...(where.pervasive.length ? ["a restriction on the whole clip"] : []),
  ];
  const inPlan = [
    ...(unlicensed.length ? [`${unlicensed.join(", ")} ${unlicensed.length > 1 ? "aren't" : "isn't"} licensed`] : licensing.length ? ["the planned use isn't licensed"] : []),
    ...(target ? [`these rules don't describe a partnership with ${target} — a reviewer must confirm it`] : []),
  ];
  const toConfirm = clubPartners.length
    ? `To confirm: ${clubPartners.join(", ")} — club partner${clubPartners.length > 1 ? "s" : ""} these rules don't list; a contract question, not a conflict`
    : "";
  const headline =
    current.verdict === "ALLOWED"
      ? "Nothing to fix: every planned use is allowed under the demo policy."
      : [inFootage.length ? `In the footage: ${inFootage.join("; ")}` : "", inPlan.length ? `In the plan: ${inPlan.join("; ")}` : "", toConfirm].filter(Boolean).join(" · ");

  // No licensed market, channel or use in the plan at all: no edit, replacement or change of use can pass — a reviewer
  // cannot grant a licence, and turning a sales post into an editorial one is a different campaign, not a fix. Only the
  // honest next step is offered.
  const remedy = licensing.length ? classifyBlocker(currentUses.map((u) => ({ intent: u.intent, decision: u.decision.decision })), ctx.policies).remedy : undefined;
  const requestedT = unique(intents.map((i) => i.territory.toUpperCase()));
  const requestedP = unique(intents.map((i) => i.platform));
  const useGap = unique(intents.map((i) => i.usage)).every((u) => unlicensedUses.includes(u));
  const licenceGap =
    licensing.length > 0 &&
    (!remedy ||
      useGap ||
      (remedy.territories !== undefined && !requestedT.some((t) => remedy.territories!.includes(t))) ||
      (remedy.platforms !== undefined && !requestedP.some((p) => remedy.platforms!.includes(p))));

  const options: PlannedOption[] = [];
  let n = 0;
  const nextId = (kind: RecoveryKind) => `${kind.toLowerCase()}-${++n}`;

  // A — TRIM the localized restrictions out of the selected footage.
  if (where.localized.length && !licenceGap) {
    const newCuts = removalsFor(where.localized, source.range, limits.boundaryMarginSec, ctx.policies);
    const edl = buildEdl({ id: `${idPrefix}:trim`, sourceAssetId: source.assetId, sourceTitle: source.title, range: source.range, removals: [...prior, ...newCuts], minPieceSec: limits.minPieceSec });
    const title = newCuts.length === 1 ? `Remove ${span(newCuts[0])}` : `Remove ${newCuts.length} flagged parts (${newCuts.map(span).join(", ")})`;
    const minKeep = Math.max(limits.minPostSec, limits.minRetainedRatio * (source.range.end - source.range.start));
    const base = {
      id: nextId("TRIM"),
      kind: "TRIM" as const,
      title,
      changesGoal: false,
      summary: `Cut the footage where ${unique(where.localized.map(whatIsThere)).join("; ")} appear${where.localized.length > 1 ? "" : "s"}, with a ${limits.boundaryMarginSec} s margin around the AI-observed boundaries, then re-check what is left.`,
    };
    if (!edl) {
      options.push({ ...base, tradeoff: "Nothing usable is left.", outcome: "NOT_VIABLE", notViableBecause: "Removing every flagged part leaves no usable footage." });
    } else if (edl.durationSec < minKeep) {
      options.push({
        ...base,
        edl,
        tradeoff: `Keeps ${secs(edl.durationSec)} of ${secs(edl.originalDurationSec)}.`,
        outcome: "NOT_VIABLE",
        notViableBecause: `Trim rejected: it would leave ${secs(edl.durationSec)} of ${secs(edl.originalDurationSec)} — below the ${secs(minKeep)} minimum for this post.`,
      });
    } else {
      const edit = edlToEditPlan(edl);
      const recheck = summarizeUses(evaluateUses(ctx, edit, intents));
      const jumps = edl.retained.length - 1;
      options.push({
        ...base,
        edl,
        edit,
        intents,
        recheck,
        tradeoff: `Keeps ${secs(edl.durationSec)} of ${secs(edl.originalDurationSec)} (${Math.round((100 * edl.durationSec) / edl.originalDurationSec)}%)${jumps ? ` with ${jumps} jump cut${jumps > 1 ? "s" : ""}` : ""}. Cut points come from AI timestamps — an editor confirms them before rendering.`,
        outcome: outcomeOf(recheck.verdict),
        ...stillBlocked(recheck),
      });
    }
  }

  // B — SAFE_SECTION: the best contiguous section of the same asset with no localized restriction. Preference:
  // overlapping the chosen moment, then a section video search ALSO matched to the goal, then the nearest.
  const assetEnd = asset?.durationSec;
  if (asset && assetEnd && where.localized.length && !licenceGap) {
    const whole = { start: 0, end: assetEnd };
    const all = locateProblems(ctx, source.assetId, [whole], intents);
    const blocked = removalsFor(all.localized, whole, limits.boundaryMarginSec, ctx.policies);
    const free = buildEdl({ id: "free", sourceAssetId: asset.id, sourceTitle: source.title, range: whole, removals: blocked, minPieceSec: limits.minPostSec })?.retained ?? [];
    const want = source.range.end - source.range.start;
    const cross = (a: Interval, b: Interval) => Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
    const overlap = (w: Interval) => cross(w, source.range);
    const distance = (w: Interval) => (overlap(w) > 0 ? 0 : Math.min(Math.abs(w.start - source.range.end), Math.abs(source.range.start - w.end)));
    const hitIn = (w: Interval) => [...(input.sourceHits ?? [])].sort((a, b) => a.rank - b.rank).find((h) => cross(h, w) >= Math.min(limits.minPostSec, h.end - h.start));
    const best = [...free].sort(
      (a, b) => overlap(b) - overlap(a) || (hitIn(a)?.rank ?? Infinity) - (hitIn(b)?.rank ?? Infinity) || distance(a) - distance(b) || b.end - b.start - (a.end - a.start),
    )[0];
    if (best) {
      // Fit to the moment's length inside the window, anchored on the chosen moment or else on the search hit.
      const len = Math.min(want, best.end - best.start);
      const hit = overlap(best) > 0 ? undefined : hitIn(best);
      const target = hit ? Math.max(hit.start, best.start) : source.range.start;
      const anchor = Math.min(Math.max(target, best.start), best.end - len);
      const pick = { start: r3(anchor), end: r3(anchor + len) };
      const sameAsTrim = options.some(
        (o) => o.kind === "TRIM" && o.edl?.retained.length === 1 && Math.abs(o.edl.retained[0].start - pick.start) < 1e-3 && Math.abs(o.edl.retained[0].end - pick.end) < 1e-3,
      );
      if (!sameAsTrim) {
        const edl = buildEdl({ id: `${idPrefix}:section`, sourceAssetId: asset.id, sourceTitle: source.title, range: pick, removals: [], minPieceSec: 0 })!;
        const edit = edlToEditPlan(edl, `${source.title} (${span(pick)})`);
        const recheck = summarizeUses(evaluateUses(ctx, edit, intents));
        const inside = overlap(pick);
        const matched = hitIn(pick);
        options.push({
          id: nextId("SAFE_SECTION"),
          kind: "SAFE_SECTION",
          title: `Use ${span(pick)} of the same clip`,
          summary: `A continuous stretch of “${source.title}” where no analysis flagged anything, as close to the chosen moment as the footage allows.`,
          tradeoff: `${secs(pick.end - pick.start)} instead of ${secs(want)}, one continuous shot.`,
          relevance:
            inside > 0
              ? `Overlaps the searched moment by ${secs(inside)}.`
              : matched
                ? `Video search also matched this section to “${matched.query}” (#${matched.rank}).`
                : `${secs(distance(pick))} away from the moment search found — search did not match this section to the goal; check it fits the story.`,
          tie: { overlapsMoment: inside > 0, ...(matched ? { searchRank: matched.rank } : {}) },
          changesGoal: false,
          edl,
          edit,
          intents,
          recheck,
          outcome: outcomeOf(recheck.verdict),
          ...stillBlocked(recheck),
        });
      }
    }
  }

  // C — REPLACE with real moments the server found and evaluated.
  for (const rep of licenceGap ? [] : (input.replacements ?? [])) {
    const recheck = summarizeUses(rep.evaluations);
    options.push({
      id: nextId("REPLACE"),
      kind: "REPLACE",
      title: `Use “${rep.title}” ${span(rep.segment)}`,
      summary: `A different real moment for the same goal, found by video search for “${rep.query}” (#${rep.rank}) and checked on its own for every use.`,
      tradeoff: "Different footage, same length, same campaign.",
      changesGoal: false,
      edit: segmentEdit(`${idPrefix}:replace:${rep.key}`, rep.title, [rep.segment], source.assetId),
      intents,
      recheck,
      replacement: { key: rep.key, title: rep.title, scoreplayMediaId: rep.segment.scoreplayMediaId, start: rep.segment.start, end: rep.segment.end, query: rep.query, rank: rep.rank },
      outcome: outcomeOf(recheck.verdict),
      ...stillBlocked(recheck),
    });
  }

  // D — ADAPT_CAMPAIGN: the restriction is in the planned use, not in the footage.
  const adapt = (keepT: string[], keepP: string[], usage: PublishIntent["usage"] | undefined, title: string, summary: string) => {
    const reduced = intents.filter((i) => keepT.includes(i.territory.toUpperCase()) && keepP.includes(i.platform)).map((i) => (usage ? { ...i, usage } : i));
    const droppedT = requestedT.filter((t) => !keepT.includes(t));
    const droppedP = requestedP.filter((p) => !keepP.includes(p));
    if (!reduced.length || !(droppedT.length || droppedP.length || usage)) return;
    const recheck = summarizeUses(evaluateUses(ctx, currentEdit, reduced));
    const parts = [droppedT.length ? `drop ${droppedT.join(", ")}` : "", droppedP.length ? `drop ${droppedP.join(", ")}` : "", usage ? `post as ${usage.toLowerCase()}` : ""].filter(Boolean);
    options.push({
      id: nextId("ADAPT_CAMPAIGN"),
      kind: "ADAPT_CAMPAIGN",
      title,
      summary,
      tradeoff: `${parts.join("; ")}. ${reduced.length} of ${intents.length} planned uses remain.`,
      changesGoal: Boolean(usage),
      edit: currentEdit,
      intents: reduced,
      recheck,
      campaignChange: { territories: keepT, ...(droppedT.length ? { dropped: droppedT } : {}), ...(droppedP.length ? { platforms: keepP } : {}), ...(usage ? { usage } : {}) },
      outcome: outcomeOf(recheck.verdict),
      ...stillBlocked(recheck),
    });
  };
  if (remedy && !licenceGap) {
    const keepT = remedy.territories ? requestedT.filter((t) => remedy.territories!.includes(t)) : requestedT;
    const keepP = remedy.platforms ? requestedP.filter((p) => remedy.platforms!.includes(p)) : requestedP;
    adapt(
      keepT,
      keepP,
      remedy.usage,
      keepT.length < requestedT.length ? `Limit to licensed markets: ${keepT.join(", ")}` : "Adjust where and how the campaign runs",
      "A different clip would hit the same restriction — it comes from where or how the campaign runs. Keep the uses the policy licenses.",
    );
  }
  // Some uses already pass (e.g. a full-match clip that may only be shown in its home market): publish there only.
  if (!options.some((o) => o.kind === "ADAPT_CAMPAIGN" && o.outcome === "RESOLVES_DEMO") && current.allowedUses > 0 && current.allowedUses < intents.length) {
    const ok = (t: string, p: string) => currentUses.some((u) => u.intent.territory.toUpperCase() === t && u.intent.platform === p && u.decision.decision.verdict === "ALLOWED");
    const keepT = requestedT.filter((t) => requestedP.every((p) => ok(t, p)));
    const keepP = keepT.length ? requestedP : requestedP.filter((p) => requestedT.every((t) => ok(t, p)));
    if (keepT.length || keepP.length) {
      const t = keepT.length ? keepT : requestedT;
      adapt(t, keepP, undefined, keepT.length ? `Publish only where it's allowed: ${t.join(", ")}` : `Publish only on ${keepP.join(", ")}`, "This footage is cleared for some of the planned markets or channels already. Keep those and drop the rest.");
    }
  }

  // E — CHANGE_USAGE: same footage as an organic post, when the restriction is specific to sales/sponsored use.
  const sells = intents.some((i) => i.usage === "COMMERCIAL" || i.usage === "SPONSORED");
  if (sells && clipProblems && !licenceGap) {
    const organic = intents.map((i) => (i.usage === "COMMERCIAL" || i.usage === "SPONSORED" ? { ...i, usage: "ORGANIC" as const } : i));
    const recheck = summarizeUses(evaluateUses(ctx, currentEdit, organic));
    if (recheck.allowedUses > current.allowedUses) {
      options.push({
        id: nextId("CHANGE_USAGE"),
        kind: "CHANGE_USAGE",
        title: "Post it as organic club content",
        summary: "The restriction applies to sales and sponsored posts. The same moment as an organic post is checked against the organic rules.",
        tradeoff: "Changes the goal: no shop link or partner placement — the post can't sell directly.",
        changesGoal: true,
        edit: currentEdit,
        intents: organic,
        recheck,
        campaignChange: { usage: "ORGANIC" },
        outcome: outcomeOf(recheck.verdict),
        ...stillBlocked(recheck),
      });
    }
  }

  // F — REQUEST_CLEARANCE: the human next step for what editing cannot fix.
  const asks: string[] = [];
  if (unlicensed.length) asks.push(`Request additional usage rights for ${unlicensed.join(", ")} from the rights holder.`);
  else if (where.campaign.length) asks.push(`Ask the rights team: ${where.campaign[0].reason.explanation}`);
  if (!licenceGap && where.pervasive.length) asks.push(`Ask the rights team to clear what applies to the whole clip: ${unique(where.pervasive.map((r) => r.explanation)).join(" ")}`);
  if (!licenceGap && where.localized.length) asks.push(`To keep this exact footage, ask the rights team to clear: ${unique(where.localized.map(whatIsThere)).join("; ")}.`);
  if (asks.length) {
    options.push({
      id: nextId("REQUEST_CLEARANCE"),
      kind: "REQUEST_CLEARANCE",
      title: unlicensed.length ? "Request additional usage rights" : "Ask the rights team for clearance",
      summary: asks.join(" "),
      tradeoff: "No automatic fix: a person with the agreements must decide.",
      changesGoal: false,
      outcome: "NEXT_STEP",
    });
  }

  // Ranking: options whose independent re-check clears every use first (keeping the goal before changing it; smallest
  // change first), then candidates that still need a reviewer, then rejected options, then next steps. Within a
  // group: allowed uses, then kind order. A candidate that fails a use is never ranked as a correction.
  const kindOrder: Record<RecoveryKind, number> = { ADAPT_CAMPAIGN: 0, TRIM: 1, REPLACE: 2, SAFE_SECTION: 3, CHANGE_USAGE: 4, REQUEST_CLEARANCE: 5 };
  // A section of the chosen clip is a smaller change than new footage when it is as tied to the goal: overlapping the
  // chosen moment, or matched by search at least as well as the best workable replacement.
  const bestReplacementRank = Math.min(...options.filter((o) => o.kind === "REPLACE" && o.outcome === "RESOLVES_DEMO").map((o) => o.replacement!.rank));
  const preference = (o: PlannedOption) =>
    o.kind === "SAFE_SECTION" && (o.tie?.overlapsMoment || (o.tie?.searchRank !== undefined && o.tie.searchRank <= bestReplacementRank)) ? 1.5 : kindOrder[o.kind];
  const group = (o: PlannedOption) =>
    o.outcome === "NEXT_STEP" ? 5 : o.outcome === "NOT_VIABLE" || o.outcome === "STILL_BLOCKED" ? 4 : o.outcome === "NEEDS_REVIEW" ? 2 : o.changesGoal ? 1 : 0;
  options.sort((a, b) => group(a) - group(b) || (b.recheck?.allowedUses ?? 0) - (a.recheck?.allowedUses ?? 0) || preference(a) - preference(b));

  // Recommended = re-checked ALLOWED for every use and the goal unchanged. Never a candidate a reviewer still has to clear.
  const recommended = options.find((o) => group(o) === 0);
  const review = options.filter((o) => o.outcome === "NEEDS_REVIEW").length;
  const noPathMessage = recommended
    ? undefined
    : licenceGap
      ? `No licensed path: ${asks[0]} A different clip or edit hits the same wall, and PULSE won't ${useGap ? "turn the campaign into a different kind of post" : "move the campaign elsewhere"}.`
      : review
        ? `No verified correction: no change keeps the goal and clears every use under these rules. ${review === 1 ? "One candidate still needs" : `${review} candidates still need`} a reviewer — not a fix.`
        : "No change PULSE can make clears this use under the selected policy. The next step is a clearance request.";
  return { scope, headline, problems, current, licenceGap, options, ...(recommended ? { recommendedId: recommended.id } : {}), ...(noPathMessage ? { noPathMessage } : {}) };
}
