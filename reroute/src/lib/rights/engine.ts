/**
 * Deterministic rights engine. Pure and synchronous.
 *
 * Each segment is evaluated under the policy selected for ITS asset (`selectPolicy`): no applicable
 * policy ⇒ MISSING (POLICY_SELECTION). Under a policy, every mandatory dimension resolves to:
 * - DENY:    a DENY rule verifiably applies (asset facts + segment evidence + intent + date). Evidence
 *            from AI analysis below MIN_DENY_CONFIDENCE never blocks on its own (capped at MISSING).
 * - MISSING: a needed fact is unknown, a DENY might apply but cannot be ruled out, or no PERMIT
 *            affirmatively and currently covers the use (absence of a deny is never permission).
 * - PERMIT:  at least one PERMIT applies, nothing is unknown, and (people/sponsor) every person and
 *            brand in the segment is covered — or a wildcard covers everyone.
 * Every reason carries a `basis`: a missing TECHNICAL_OBSERVATION (video not analysed) is never reported
 * as a missing LEGAL_ENTITLEMENT, and an unproven ScorePlay↔TwelveLabs link is MEDIA_IDENTITY.
 * Verdict: any DENY → BLOCKED, else any MISSING → NEEDS_REVIEW, else ALLOWED.
 */
import {
  MANDATORY_DIMENSIONS,
  type Asset,
  type Clearance,
  type Decision,
  type Dimension,
  type EditDecision,
  type EditPlan,
  type Evidence,
  type PolicySelection,
  type PublishIntent,
  type Reason,
  type ReasonBasis,
  type Segment,
  type SegmentDecision,
  type Verdict,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { sameClub } from "./club";
import type { Policy, Rule } from "./policy";
import { BUNDLED_POLICIES } from "./registry";
import { applicabilityFailures, noPolicyReasons, selectPolicy } from "./select";

/** AI observations below this confidence may raise a question (MISSING) but never block (DENY). */
export const MIN_DENY_CONFIDENCE = 0.6;

/** A publish date older than `now` minus this grace is treated as a stale intent (NEEDS_REVIEW, CAMPAIGN scope). */
export const PAST_PUBLISH_GRACE_MS = 5 * 60_000;
export const PAST_PUBLISH_RULE_ID = "intent:publish-date-past";

/** Whether machine video analysis is usable for an asset. UNLINKABLE = media identity not proven. */
export type AnalysisStatus =
  | { status: "AVAILABLE" }
  | { status: "NOT_CONFIGURED" | "FAILED" | "UNLINKABLE"; detail: string };

export interface EvaluateSegmentInput {
  segment: Segment;
  asset: Asset;
  observations: Evidence[];
  analysis: AnalysisStatus;
  intent: PublishIntent;
  policy: Policy;
  now: Date;
}

export interface EvaluateEditInput {
  edit: EditPlan;
  assets: Record<string, Asset>;
  observations: Record<string, Evidence[]>;
  analysis: Record<string, AnalysisStatus>;
  intent: PublishIntent;
  now: Date;
  /** Candidate policies (default: bundled). Selection still applies — this is not an override. */
  policies?: readonly Policy[];
}

// ---------- Normalization ----------

function slug(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "Brand: Acme Énergie" → "brand:acme-energie"; every ":"-separated part is slugged. */
export function normalizeLabel(raw: string): string {
  return raw.split(":").map(slug).join(":");
}

/** Case/punctuation-insensitive match; a trailing "*" in the pattern means prefix match. */
export function matchesPattern(value: string, pattern: string): boolean {
  const v = normalizeLabel(value);
  return pattern.endsWith("*") ? v.startsWith(normalizeLabel(pattern.slice(0, -1))) : v === normalizeLabel(pattern);
}

const sameSlug = (a: string, b: string) => slug(a) === slug(b);

// ---------- Segment context ----------

type Tri = "YES" | "NO" | "UNKNOWN";

interface Unknown {
  what: string;
  basis: ReasonBasis;
  /** Set when the unknown is a missing ScorePlay fact about the asset (→ CLIP-scope reason ids `fact:<fact>:<rule>`). */
  fact?: "competition" | "team" | "people";
}

interface Subject {
  label: string;
  display: string;
  /** People only: club per ScorePlay squad registration. */
  club: "OWN" | "OTHER" | "UNKNOWN";
  clubs: string[];
  evidence: Evidence[];
}

interface SegmentContext {
  segment: Segment;
  asset: Asset;
  evidence: Evidence[];
  analysis: AnalysisStatus;
  intent: PublishIntent;
  policy: Policy;
  publishAt: Date;
  now: Date;
  people: Subject[];
  brands: Subject[];
  /** Evidence that triggered or was covered by a rule (reported in the Decision). */
  used: Set<Evidence>;
}

interface RuleCheck {
  rule: Rule;
  selector: Tri;
  unknowns: Unknown[];
  /** Segment evidence whose label matched `match.evidenceLabels`. */
  triggering: Evidence[];
  /** Human-readable intent conditions that do not hold. Empty = intent matches. */
  intentMisses: string[];
  window: "VALID" | "NOT_YET" | "EXPIRED";
}

function overlaps(ev: Evidence, seg: Segment): boolean {
  const start = ev.start ?? 0;
  const end = ev.end ?? Number.POSITIVE_INFINITY;
  if (start === end) return start >= seg.start && start < seg.end; // point observation
  return start < seg.end && end > seg.start;
}

/** AI evidence below threshold (or without a confidence) is not strong enough to block. */
const canBlock = (ev: Evidence) => ev.source !== "TWELVELABS" || (ev.confidence ?? 0) >= MIN_DENY_CONFIDENCE;

const entityOf = (ev: Evidence) => ev.observation.split(":")[0]?.trim() || ev.label!;

function analysisGap(analysis: AnalysisStatus): Unknown | undefined {
  switch (analysis.status) {
    case "AVAILABLE":
      return undefined;
    case "UNLINKABLE":
      return {
        basis: "MEDIA_IDENTITY",
        what: `this ScorePlay clip could not be matched to exactly one analysed video (${analysis.detail}), so no video analysis can be attached to it`,
      };
    case "NOT_CONFIGURED":
      return { basis: "TECHNICAL_OBSERVATION", what: `the video was not analysed (video analysis is not configured: ${analysis.detail})` };
    case "FAILED":
      return { basis: "TECHNICAL_OBSERVATION", what: `the video was not analysed (analysis failed: ${analysis.detail})` };
  }
}

function buildSubjects(asset: Asset, evidence: Evidence[], policy: Policy): { people: Subject[]; brands: Subject[] } {
  const clubNames = policy.applicability.clubNames;
  const people: Subject[] = (asset.facts.people ?? []).map((name) => {
    const clubs = asset.facts.peopleTeams?.[name] ?? [];
    const own = clubs.some((c) => clubNames.some((n) => sameClub(c, n)));
    return { label: `person:${slug(name)}`, display: name, club: own ? "OWN" : clubs.length ? "OTHER" : "UNKNOWN", clubs, evidence: [] };
  });
  for (const ev of evidence) {
    const label = ev.label ? normalizeLabel(ev.label) : "";
    if (!label.startsWith("person:")) continue;
    // A label identifies a listed person only when its name tokens match exactly one of them.
    const tokens = label.slice("person:".length).split("-").filter(Boolean);
    const matches = people.filter((p) => {
      const nameTokens = new Set(p.label.slice("person:".length).split("-"));
      return tokens.length > 0 && tokens.every((t) => nameTokens.has(t));
    });
    const existing = matches.length === 1 ? matches[0] : people.find((p) => p.label === label);
    if (existing) existing.evidence.push(ev);
    else people.push({ label, display: entityOf(ev), club: "UNKNOWN", clubs: [], evidence: [ev] });
  }
  const brands = new Map<string, Subject>();
  for (const name of asset.facts.sponsors ?? []) {
    const label = `brand:${slug(name)}`;
    brands.set(label, { label, display: name, club: "UNKNOWN", clubs: [], evidence: [] });
  }
  for (const ev of evidence) {
    const label = ev.label ? normalizeLabel(ev.label) : "";
    if (!label.startsWith("brand:")) continue;
    const s = brands.get(label) ?? { label, display: entityOf(ev), club: "UNKNOWN" as const, clubs: [], evidence: [] };
    s.evidence.push(ev);
    brands.set(label, s);
  }
  return { people, brands: [...brands.values()] };
}

// ---------- Rule applicability ----------

function checkRule(rule: Rule, ctx: SegmentContext): RuleCheck {
  const { asset, intent, evidence, analysis } = ctx;
  const parts: Tri[] = [];
  const unknowns: Unknown[] = [];
  let triggering: Evidence[] = [];
  const { match } = rule;

  if (match.competition) {
    const fact = asset.facts.competition?.trim();
    if (!fact) {
      unknowns.push({ basis: "LEGAL_ENTITLEMENT", fact: "competition", what: "the clip's competition is not recorded in ScorePlay" });
      parts.push("UNKNOWN");
    } else parts.push(match.competition.some((p) => sameSlug(fact, p)) ? "YES" : "NO");
  }
  if (match.team) {
    const teams = asset.facts.teams;
    if (!teams?.length) {
      unknowns.push({ basis: "LEGAL_ENTITLEMENT", fact: "team", what: "the clip's club is not tagged in ScorePlay" });
      parts.push("UNKNOWN");
    } else parts.push(teams.some((t) => match.team!.some((p) => sameClub(t, p))) ? "YES" : "NO");
  }
  if (match.assetIds) parts.push(match.assetIds.includes(asset.id) ? "YES" : "NO");
  if (match.assetTags) parts.push(asset.tags.some((tag) => match.assetTags!.some((p) => matchesPattern(tag, p))) ? "YES" : "NO");
  if (match.noListedPeople) {
    // YES only when ScorePlay positively lists no player (map.ts: people = []); unknown list ⇒ UNKNOWN.
    const people = asset.facts.people;
    if (!people) {
      unknowns.push({ basis: "LEGAL_ENTITLEMENT", fact: "people", what: "ScorePlay does not say whether players appear in the clip" });
      parts.push("UNKNOWN");
    } else parts.push(people.length ? "NO" : "YES");
  }
  if (match.otherClubPeople) parts.push(ctx.people.some((p) => p.club === "OTHER") ? "YES" : "NO");
  if (match.evidenceLabels) {
    const except = match.evidenceLabelsExcept ?? [];
    triggering = evidence.filter(
      (ev) => ev.label !== undefined && match.evidenceLabels!.some((p) => matchesPattern(ev.label!, p)) && !except.some((p) => matchesPattern(ev.label!, p)),
    );
    const gap = analysisGap(analysis);
    if (triggering.length > 0) parts.push("YES");
    else if (!gap) parts.push("NO");
    else {
      unknowns.push(gap);
      parts.push("UNKNOWN");
    }
  }
  const selector: Tri = parts.includes("NO") ? "NO" : parts.includes("UNKNOWN") ? "UNKNOWN" : "YES";

  const intentMisses: string[] = [];
  const cond = rule.intent;
  const territory = intent.territory.trim().toUpperCase();
  if (cond?.territories && !cond.territories.some((t) => t.trim().toUpperCase() === territory)) {
    intentMisses.push(`territory ${territory} is not licensed (licensed: ${cond.territories.join(", ")})`);
  }
  if (cond?.exceptTerritories?.some((t) => t.trim().toUpperCase() === territory)) {
    intentMisses.push(`territory ${territory} is excluded`);
  }
  if (cond?.platforms && !cond.platforms.some((p) => sameSlug(p, intent.platform))) {
    intentMisses.push(`platform ${intent.platform} is not licensed (licensed: ${cond.platforms.join(", ")})`);
  }
  if (cond?.usage && !cond.usage.includes(intent.usage)) {
    intentMisses.push(`${intent.usage} use is not licensed (licensed: ${cond.usage.join(", ")})`);
  }

  const t = ctx.publishAt.getTime();
  const window =
    rule.validFrom && t < Date.parse(rule.validFrom) ? "NOT_YET" : rule.validUntil && t > Date.parse(rule.validUntil) ? "EXPIRED" : "VALID";

  return { rule, selector, unknowns, triggering, intentMisses, window };
}

const applies = (c: RuleCheck) => c.intentMisses.length === 0 && c.window === "VALID";

// ---------- Dimension evaluation ----------

function reason(
  ctx: SegmentContext,
  ruleId: string,
  dimension: string,
  outcome: Reason["outcome"],
  basis: ReasonBasis,
  explanation: string,
  triggering: Evidence[] = [],
): Reason {
  let { start, end } = ctx.segment;
  const timed = triggering.filter((e) => e.start !== undefined || e.end !== undefined);
  if (timed.length > 0) {
    // Narrow to the evidence that triggered the rule, clipped to the segment.
    start = Math.max(start, Math.min(...timed.map((e) => e.start ?? start)));
    end = Math.min(end, Math.max(...timed.map((e) => e.end ?? end)));
  }
  triggering.forEach((e) => ctx.used.add(e));
  return { ruleId, dimension, outcome, basis, explanation, scoreplayMediaId: ctx.segment.scoreplayMediaId, start, end };
}

const day = (iso: string) => iso.slice(0, 10);

/** Reason id for a rule whose applicability is uncertain: asset-fact gaps get a CLIP-scope `fact:` id. */
const uncertainRuleId = (c: RuleCheck) => (c.unknowns[0]?.fact ? `fact:${c.unknowns[0].fact}:${c.rule.id}` : c.rule.id);

function nearMiss(c: RuleCheck, publishAt: string): { basis: ReasonBasis; text: string } {
  if (c.selector === "UNKNOWN") {
    return { basis: c.unknowns[0].basis, text: `${c.rule.explanation} This cannot be confirmed because ${c.unknowns.map((u) => u.what).join(" and ")}.` };
  }
  if (c.window === "EXPIRED") return { basis: "LEGAL_ENTITLEMENT", text: `The licence (${c.rule.id}) ended on ${day(c.rule.validUntil!)}; the publish date is ${day(publishAt)}.` };
  if (c.window === "NOT_YET") return { basis: "LEGAL_ENTITLEMENT", text: `The licence (${c.rule.id}) only starts on ${day(c.rule.validFrom!)}; the publish date is ${day(publishAt)}.` };
  return { basis: "LEGAL_ENTITLEMENT", text: `Not licensed: ${c.intentMisses.join("; ")}. ${c.rule.explanation}` };
}

function competitionGaps(ctx: SegmentContext): Reason[] {
  const fact = ctx.asset.facts.competition?.trim();
  if (!fact) {
    return [reason(ctx, "fact:competition", "competition", "MISSING", "LEGAL_ENTITLEMENT", `The competition of "${ctx.asset.title}" is not recorded in ScorePlay.`)];
  }
  if (!sameSlug(fact, ctx.intent.competition)) {
    return [reason(ctx, "fact:competition", "competition", "MISSING", "LEGAL_ENTITLEMENT", `"${ctx.asset.title}" is ${fact} footage but the campaign is for ${ctx.intent.competition}.`)];
  }
  return [];
}

const covers = (rule: Rule, s: Subject) =>
  (rule.covers ?? []).some((p) => (p.toLowerCase() === "squad:own" ? s.label.startsWith("person:") && s.club === "OWN" : matchesPattern(s.label, p)));

/** people/sponsor: every identified subject must be covered; without a wildcard the subject list must be complete. */
function coverageGaps(dim: "people" | "sponsor", permits: RuleCheck[], ctx: SegmentContext): Reason[] {
  const ns = dim === "people" ? "person" : "brand";
  const subjects = dim === "people" ? ctx.people : ctx.brands;
  if (permits.some((c) => c.rule.covers?.includes(`${ns}:*`))) {
    subjects.forEach((s) => s.evidence.forEach((e) => ctx.used.add(e)));
    return [];
  }
  const out: Reason[] = [];
  const usage = ctx.intent.usage;
  const gap = analysisGap(ctx.analysis);
  if (gap) {
    out.push(
      reason(
        ctx,
        "analysis-unavailable",
        dim,
        "MISSING",
        gap.basis,
        dim === "people"
          ? `Who appears on screen cannot be confirmed because ${gap.what}. ${usage} use requires every identifiable person to be cleared.`
          : `Which brands appear on screen cannot be confirmed because ${gap.what}. ${usage} use requires every visible brand to be cleared.`,
      ),
    );
  }
  for (const s of subjects) {
    if (permits.some((c) => covers(c.rule, s))) {
      s.evidence.forEach((e) => ctx.used.add(e));
      continue;
    }
    const club = ctx.policy.applicability.clubNames[0];
    const post = usage === "COMMERCIAL" ? "a sales post" : usage === "SPONSORED" ? "a sponsored post" : `${usage.toLowerCase()} use`;
    const aiOnly = s.evidence.length > 0 && s.evidence.every((e) => e.source === "TWELVELABS");
    const text =
      dim === "sponsor"
        ? `${s.display} isn't an official partner in ${ctx.policy.title}, so it can't appear in ${post}.`
        : s.club === "OTHER"
          ? `${s.display} plays for ${s.clubs.join(", ")} (per ScorePlay), so ${club}'s image rights can't cover them in ${post}.`
          : aiOnly
            ? `Video analysis identified “${s.display}”, who can't be matched to ${club}'s registered squad in ScorePlay, so the club's image rights can't be confirmed for ${post}. AI identifications can be wrong — a reviewer must confirm who it is.`
            : `${s.display} isn't on ${club}'s registered squad in ScorePlay, so the club's image rights can't cover them in ${post}.`;
    out.push(reason(ctx, `subject:${s.label}`, dim, "MISSING", "LEGAL_ENTITLEMENT", text, s.evidence));
  }
  if (dim === "people" && !gap && ctx.people.length === 0) {
    const focus = ctx.evidence.find((e) => e.label && normalizeLabel(e.label).startsWith("rubric:player-focus:"));
    if (!focus) {
      out.push(reason(ctx, "analysis:player-focus", dim, "MISSING", "TECHNICAL_OBSERVATION", "The video analysis did not report whether players are on screen."));
    } else if (normalizeLabel(focus.label!) !== "rubric:player-focus:no-players") {
      out.push(
        reason(
          ctx,
          "analysis:player-focus",
          dim,
          "MISSING",
          "TECHNICAL_OBSERVATION",
          `The video analysis reports players on screen (${focus.observation}) but none is identified, so their image rights cannot be checked.`,
          [focus],
        ),
      );
    } else if (!ctx.asset.facts.people) {
      // "Nobody identifiable" needs ScorePlay to positively list no player; analysis alone is not enough.
      out.push(
        reason(
          ctx,
          "fact:people",
          dim,
          "MISSING",
          "LEGAL_ENTITLEMENT",
          `The video analysis found no identifiable player, but ScorePlay does not say whether players appear in "${ctx.asset.title}", so ${usage} use cannot be cleared.`,
          [focus],
        ),
      );
    } else ctx.used.add(focus);
  }
  return out;
}

function evaluateDimension(dim: Dimension, ctx: SegmentContext, all: RuleCheck[]): Reason[] {
  const checks = all.filter((c) => c.rule.dimensions.includes(dim));

  const denies = checks.filter((c) => c.rule.effect === "DENY" && c.selector === "YES" && applies(c));
  // A DENY triggered only by evidence must have at least one observation strong enough to block.
  const strong = denies.filter((c) => !c.rule.match.evidenceLabels || c.triggering.some(canBlock));
  if (strong.length > 0) {
    return strong.map((c) => {
      if (!c.rule.match.evidenceLabels) return reason(ctx, c.rule.id, dim, "DENY", "LEGAL_ENTITLEMENT", c.rule.explanation, c.triggering);
      const seen = c.triggering.filter(canBlock);
      const what = [...new Set(seen.map((e) => `${entityOf(e)} (${e.source === "HUMAN" ? "flagged by reviewer" : "crest/kit or boards"})${e.start !== undefined ? `, ${e.start}–${e.end ?? e.start} s` : ""}`))];
      return reason(ctx, c.rule.id, dim, "DENY", "LEGAL_ENTITLEMENT", `${c.rule.explanation} Third-party branding on screen: ${what.join("; ")}.`, seen);
    });
  }

  const missing: Reason[] = dim === "competition" ? competitionGaps(ctx) : [];
  for (const c of denies) {
    const best = Math.max(...c.triggering.map((e) => e.confidence ?? 0));
    missing.push(
      reason(
        ctx,
        c.rule.id,
        dim,
        "MISSING",
        "TECHNICAL_OBSERVATION",
        `${c.rule.explanation} Only AI video analysis flagged this, with confidence ${best.toFixed(2)} (below ${MIN_DENY_CONFIDENCE}), so it cannot block on its own. A reviewer must confirm.`,
        c.triggering,
      ),
    );
  }
  for (const c of checks) {
    if (c.rule.effect === "DENY" && c.selector === "UNKNOWN" && applies(c)) {
      missing.push(
        reason(ctx, uncertainRuleId(c), dim, "MISSING", c.unknowns[0].basis, `This restriction may apply but cannot be ruled out because ${c.unknowns.map((u) => u.what).join(" and ")}. ${c.rule.explanation}`),
      );
    }
  }

  const permits = checks.filter((c) => c.rule.effect === "PERMIT" && c.selector === "YES" && applies(c));
  if (permits.length === 0) {
    const near = checks.filter((c) => c.rule.effect === "PERMIT" && c.selector !== "NO");
    if (near.length > 0) {
      for (const c of near) {
        const m = nearMiss(c, ctx.intent.publishAt);
        missing.push(reason(ctx, c.selector === "UNKNOWN" ? uncertainRuleId(c) : c.rule.id, dim, "MISSING", m.basis, m.text));
      }
    } else {
      missing.push(reason(ctx, `no-rule:${dim}`, dim, "MISSING", "LEGAL_ENTITLEMENT", `No rule in ${ctx.policy.title} grants ${dim} for this clip and intent.`));
    }
    return missing;
  }
  if (dim === "people" || dim === "sponsor") missing.push(...coverageGaps(dim, permits, ctx));

  if (missing.length > 0) return missing;
  return permits.map((c) => reason(ctx, c.rule.id, dim, "PERMIT", "LEGAL_ENTITLEMENT", c.rule.explanation, c.triggering));
}

/** Club / provenance / term of the policy itself (selection is re-checked here, never assumed). */
function policyReasons(ctx: SegmentContext): Reason[] {
  const { policy, asset, intent } = ctx;
  const a = policy.applicability;
  const failures = applicabilityFailures(policy, intent, [asset]);
  if (failures.length > 0) {
    return failures.map((f) => reason(ctx, `policy-selection:${policy.id}:${f.dimension}`, f.dimension, "MISSING", "POLICY_SELECTION", f.message));
  }
  const out = [
    reason(ctx, "selection:club", "club", "PERMIT", "POLICY_SELECTION", `"${asset.title}" is tagged ${a.clubNames[0]} in ScorePlay and is published by the club, so ${policy.title} applies.`),
  ];
  if (a.provenance) {
    out.push(reason(ctx, "selection:provenance", "provenance", "PERMIT", "POLICY_SELECTION", `Provenance: ${a.provenance.description}.`));
  }
  const t = ctx.publishAt.getTime();
  if (t < ctx.now.getTime() - PAST_PUBLISH_GRACE_MS) {
    // A date already gone is an intent problem, not a licence verdict: ask for a current date (never BLOCKED by the term).
    out.push(
      reason(
        ctx,
        PAST_PUBLISH_RULE_ID,
        "expiry",
        "MISSING",
        "LEGAL_ENTITLEMENT",
        `The publish date ${day(intent.publishAt)} is in the past — re-check with a current publish date.`,
      ),
    );
  } else if (t < Date.parse(a.validFrom) || t > Date.parse(a.validUntil)) {
    out.push(
      reason(
        ctx,
        "policy-term",
        "expiry",
        "DENY",
        "LEGAL_ENTITLEMENT",
        `The publish date ${day(intent.publishAt)} is outside the term of ${policy.title} (${day(a.validFrom)} to ${day(a.validUntil)}).`,
      ),
    );
  }
  return out;
}

// ---------- Decisions ----------

/** ALLOWED requires an affirmative PERMIT on every mandatory dimension and nothing else. */
function verdictOf(reasons: Reason[]): Verdict {
  if (reasons.some((r) => r.outcome === "DENY")) return "BLOCKED";
  if (reasons.some((r) => r.outcome === "MISSING")) return "NEEDS_REVIEW";
  const permitted = new Set(reasons.filter((r) => r.outcome === "PERMIT").map((r) => r.dimension));
  return MANDATORY_DIMENSIONS.every((d) => permitted.has(d)) ? "ALLOWED" : "NEEDS_REVIEW";
}

const SEVERITY: Record<Verdict, number> = { ALLOWED: 0, NEEDS_REVIEW: 1, BLOCKED: 2 };

export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((a, b) => (SEVERITY[b] > SEVERITY[a] ? b : a), "ALLOWED");
}

/** VERIFIED only when ALLOWED under verified policies exclusively; DEMO when any demo policy took part. */
export function clearanceOf(verdict: Verdict, policyKinds: readonly ("VERIFIED" | "DEMO")[]): Clearance {
  if (verdict !== "ALLOWED" || policyKinds.length === 0) return "NONE";
  return policyKinds.every((k) => k === "VERIFIED") ? "VERIFIED" : "DEMO";
}

function uniqueBy<T>(items: readonly T[], key: (t: T) => string): T[] {
  return [...new Map(items.map((t) => [key(t), t])).values()];
}

const reasonKey = (r: Reason) => JSON.stringify([r.ruleId, r.dimension, r.outcome, r.scoreplayMediaId, r.start, r.end, r.explanation]);
const evidenceKey = (e: Evidence) => JSON.stringify([e.scoreplayMediaId, e.start, e.end, e.label, e.observation, e.source]);

/** Assemble a Decision. `policies` = every policy that took part (none ⇒ policyId "none"). */
export function buildDecision(input: {
  verdict?: Verdict;
  reasons: Reason[];
  evidence: Evidence[];
  policies: readonly Pick<Policy, "id" | "version" | "kind">[];
  policySelection?: PolicySelection;
  now: Date;
}): Decision {
  const reasons = uniqueBy(input.reasons, reasonKey);
  const policies = uniqueBy(input.policies, (p) => p.id);
  const verdict = input.verdict ?? verdictOf(reasons);
  return {
    verdict,
    reasons,
    missingFacts: [...new Set(reasons.filter((r) => r.outcome === "MISSING").map((r) => r.explanation))],
    evidence: uniqueBy(input.evidence, evidenceKey),
    policyVersion: policies.length ? policies.map((p) => p.version).join("+") : "none",
    policyId: policies.length ? policies.map((p) => p.id).join("+") : "none",
    policyFictional: policies.some((p) => p.kind === "DEMO"),
    clearance: clearanceOf(verdict, policies.map((p) => p.kind)),
    ...(input.policySelection ? { policySelection: input.policySelection } : {}),
    evaluatedAt: input.now.toISOString(),
  };
}

/** One segment under an explicit policy (callers normally use `evaluateEdit`, which selects it). */
export function evaluateSegment({ segment, asset, observations, analysis, intent, policy, now }: EvaluateSegmentInput): Decision {
  if (segment.scoreplayMediaId !== asset.id) {
    throw new AppError("BAD_REQUEST", `Segment belongs to ${segment.scoreplayMediaId} but asset ${asset.id} was supplied`);
  }
  if (!(segment.end > segment.start)) {
    throw new AppError("BAD_REQUEST", `Segment ${segment.start}–${segment.end}s of ${asset.id} is empty`);
  }
  const publishAt = new Date(intent.publishAt);
  if (Number.isNaN(publishAt.getTime())) {
    throw new AppError("BAD_REQUEST", `Invalid publishAt "${intent.publishAt}"`);
  }

  const evidence = observations.filter((ev) => ev.scoreplayMediaId === asset.id && overlaps(ev, segment));
  const ctx: SegmentContext = {
    segment,
    asset,
    evidence,
    analysis,
    intent,
    policy,
    publishAt,
    now,
    ...buildSubjects(asset, evidence, policy),
    used: new Set(),
  };
  const checks = policy.rules.map((rule) => checkRule(rule, ctx));
  const reasons = [...policyReasons(ctx), ...MANDATORY_DIMENSIONS.flatMap((dim) => evaluateDimension(dim, ctx, checks))];
  return buildDecision({ reasons, evidence: [...ctx.used], policies: [policy], now });
}

/** A segment whose ScorePlay asset could not be loaded: nothing about it is known. */
function unloadedAssetDecision(segment: Segment, now: Date): Decision {
  const reasons: Reason[] = [
    {
      ruleId: "fact:asset",
      dimension: "media",
      outcome: "MISSING",
      basis: "MEDIA_IDENTITY",
      explanation: `ScorePlay asset ${segment.scoreplayMediaId} could not be loaded, so nothing about its rights is known.`,
      scoreplayMediaId: segment.scoreplayMediaId,
      start: segment.start,
      end: segment.end,
    },
  ];
  return buildDecision({ reasons, evidence: [], policies: [], now });
}

/**
 * Evaluates every constituent segment independently — each under the policy selected for its own asset —
 * then aggregates. Derived edits are evaluated like any other edit: no verdict is inherited from the source.
 */
export function evaluateEdit({ edit, assets, observations, analysis, intent, now, policies = BUNDLED_POLICIES }: EvaluateEditInput): EditDecision {
  const used: Policy[] = [];
  const segments: SegmentDecision[] = edit.segments.map((segment) => {
    const asset = assets[segment.scoreplayMediaId];
    if (!asset) return { segment, decision: unloadedAssetDecision(segment, now) };
    const choice = selectPolicy(intent, [asset], policies);
    let decision: Decision;
    if (choice.policy) {
      used.push(choice.policy);
      decision = evaluateSegment({
        segment,
        asset,
        observations: observations[asset.id] ?? [],
        analysis: analysis[asset.id] ?? { status: "FAILED", detail: "analysis status not loaded" },
        intent,
        policy: choice.policy,
        now,
      });
    } else {
      decision = buildDecision({ reasons: noPolicyReasons(choice, intent, segment), evidence: [], policies: [], now });
    }
    return { segment, decision: { ...decision, policySelection: choice.selection } };
  });

  const loaded = edit.segments.flatMap((s) => (assets[s.scoreplayMediaId] ? [assets[s.scoreplayMediaId]] : []));
  const decision = buildDecision({
    // Aggregate rule: any BLOCKED → BLOCKED, else any NEEDS_REVIEW → NEEDS_REVIEW, else ALLOWED.
    verdict: worstVerdict(segments.map((s) => s.decision.verdict)),
    reasons: segments.flatMap((s) => s.decision.reasons),
    evidence: segments.flatMap((s) => s.decision.evidence),
    policies: used,
    policySelection: selectPolicy(intent, uniqueBy(loaded, (a) => a.id), policies).selection,
    now,
  });
  return { edit, decision, segments };
}
