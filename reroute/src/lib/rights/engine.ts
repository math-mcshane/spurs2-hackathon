/**
 * Deterministic rights engine. Pure and synchronous.
 *
 * Per segment, every mandatory dimension resolves to DENY, PERMIT or MISSING:
 * - DENY:    a DENY rule verifiably applies (asset facts + segment evidence + intent + date).
 * - MISSING: a needed fact is unknown, a DENY might apply but cannot be ruled out, or no PERMIT
 *            affirmatively and currently covers the use (absence of a deny is never permission).
 * - PERMIT:  at least one PERMIT applies, nothing is unknown, and (people/sponsor) every person
 *            and brand known to be in the segment is covered.
 * Verdict: any DENY → BLOCKED, else any MISSING → NEEDS_REVIEW, else ALLOWED.
 */
import {
  MANDATORY_DIMENSIONS,
  type Asset,
  type Decision,
  type Dimension,
  type EditDecision,
  type EditPlan,
  type Evidence,
  type PublishIntent,
  type Reason,
  type Segment,
  type SegmentDecision,
  type Verdict,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import type { Policy, Rule } from "./policy";

export interface EvaluateSegmentInput {
  segment: Segment;
  asset: Asset;
  observations: Evidence[];
  intent: PublishIntent;
  policy: Policy;
  now: Date;
}

export interface EvaluateEditInput {
  edit: EditPlan;
  assets: Record<string, Asset>;
  observations: Record<string, Evidence[]>;
  intent: PublishIntent;
  policy: Policy;
  now: Date;
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

/** "Brand: Acme Énergie" → "brand:acme-energie"; labels without a namespace are slugged whole. */
export function normalizeLabel(raw: string): string {
  const idx = raw.indexOf(":");
  return idx < 0 ? slug(raw) : `${slug(raw.slice(0, idx))}:${slug(raw.slice(idx + 1))}`;
}

/** Case/punctuation-insensitive match; a trailing "*" in the pattern means prefix match. */
function matchesPattern(value: string, pattern: string): boolean {
  const v = normalizeLabel(value);
  return pattern.endsWith("*") ? v.startsWith(normalizeLabel(pattern.slice(0, -1))) : v === normalizeLabel(pattern);
}

const sameSlug = (a: string, b: string) => slug(a) === slug(b);

// ---------- Rule applicability ----------

type Tri = "YES" | "NO" | "UNKNOWN";

interface RuleCheck {
  rule: Rule;
  /** Does the rule's `match` selector hit this asset/segment? UNKNOWN when it depends on an unknown fact. */
  selector: Tri;
  unknownFacts: string[];
  /** Segment evidence whose label matched `match.evidenceLabels`. */
  triggering: Evidence[];
  /** Human-readable intent conditions that do not hold. Empty = intent matches. */
  intentMisses: string[];
  window: "VALID" | "NOT_YET" | "EXPIRED";
}

interface SegmentContext {
  segment: Segment;
  asset: Asset;
  evidence: Evidence[];
  intent: PublishIntent;
  policy: Policy;
  checks: RuleCheck[];
  /** Evidence that triggered or was covered by a rule (reported in the Decision). */
  used: Set<Evidence>;
}

function overlaps(ev: Evidence, seg: Segment): boolean {
  const start = ev.start ?? 0;
  const end = ev.end ?? Number.POSITIVE_INFINITY;
  if (start === end) return start >= seg.start && start < seg.end; // point observation
  return start < seg.end && end > seg.start;
}

function checkRule(rule: Rule, asset: Asset, evidence: Evidence[], intent: PublishIntent, publishAt: Date): RuleCheck {
  const parts: Tri[] = [];
  const unknownFacts: string[] = [];
  let triggering: Evidence[] = [];
  const { match } = rule;

  for (const key of ["competition", "team"] as const) {
    const patterns = match[key];
    if (!patterns) continue;
    const fact = asset.facts[key]?.trim();
    if (!fact) {
      unknownFacts.push(key);
      parts.push("UNKNOWN");
    } else {
      parts.push(patterns.some((p) => sameSlug(fact, p)) ? "YES" : "NO");
    }
  }
  if (match.assetIds) parts.push(match.assetIds.includes(asset.id) ? "YES" : "NO");
  if (match.assetTags) {
    const tags = match.assetTags;
    parts.push(asset.tags.some((tag) => tags.some((p) => matchesPattern(tag, p))) ? "YES" : "NO");
  }
  if (match.evidenceLabels) {
    const patterns = match.evidenceLabels;
    triggering = evidence.filter((ev) => ev.label !== undefined && patterns.some((p) => matchesPattern(ev.label!, p)));
    parts.push(triggering.length > 0 ? "YES" : "NO");
  }
  const selector: Tri = parts.includes("NO") ? "NO" : parts.includes("UNKNOWN") ? "UNKNOWN" : "YES";

  const intentMisses: string[] = [];
  const cond = rule.intent;
  if (cond?.territories && !cond.territories.some((t) => t.trim().toUpperCase() === intent.territory.trim().toUpperCase())) {
    intentMisses.push(`territory "${intent.territory}" (covers ${cond.territories.join(", ")})`);
  }
  if (cond?.platforms && !cond.platforms.some((p) => sameSlug(p, intent.platform))) {
    intentMisses.push(`platform "${intent.platform}" (covers ${cond.platforms.join(", ")})`);
  }
  if (cond?.usage && !cond.usage.includes(intent.usage)) {
    intentMisses.push(`usage ${intent.usage} (covers ${cond.usage.join(", ")})`);
  }

  const t = publishAt.getTime();
  const window =
    rule.validFrom && t < Date.parse(rule.validFrom)
      ? "NOT_YET"
      : rule.validUntil && t > Date.parse(rule.validUntil)
        ? "EXPIRED"
        : "VALID";

  return { rule, selector, unknownFacts, triggering, intentMisses, window };
}

const applies = (c: RuleCheck) => c.intentMisses.length === 0 && c.window === "VALID";

// ---------- Dimension evaluation ----------

function reason(
  ctx: SegmentContext,
  ruleId: string,
  dimension: Dimension,
  outcome: Reason["outcome"],
  explanation: string,
  triggering: Evidence[] = [],
): Reason {
  let { start, end } = ctx.segment;
  if (triggering.length > 0) {
    // Narrow to the evidence that triggered the rule, clipped to the segment.
    start = Math.max(start, Math.min(...triggering.map((e) => e.start ?? start)));
    end = Math.min(end, Math.max(...triggering.map((e) => e.end ?? end)));
  }
  return { ruleId, dimension, outcome, explanation, scoreplayMediaId: ctx.segment.scoreplayMediaId, start, end };
}

/** Unknown or conflicting asset facts for a dimension (asset.facts unknown ⇒ never PERMIT). */
function factGaps(dim: Dimension, { asset, intent }: SegmentContext): string[] {
  switch (dim) {
    case "competition": {
      const fact = asset.facts.competition?.trim();
      if (!fact) return [`Competition of asset ${asset.id} is not recorded in ScorePlay metadata`];
      if (!sameSlug(fact, intent.competition)) {
        return [`Asset ${asset.id} is ${fact} footage but the intended competition is ${intent.competition}`];
      }
      return [];
    }
    case "people":
      return asset.facts.people ? [] : [`People appearing in asset ${asset.id} are not recorded in ScorePlay metadata`];
    case "sponsor":
      return asset.facts.sponsors ? [] : [`Sponsors/branding in asset ${asset.id} are not recorded in ScorePlay metadata`];
    default:
      return [];
  }
}

/** People or brands known to be in the segment: asset facts + labelled segment evidence. */
function subjects(dim: "people" | "sponsor", ctx: SegmentContext): { labels: string[]; evidence: Evidence[] } {
  const ns = dim === "people" ? "person" : "brand";
  const facts = (dim === "people" ? ctx.asset.facts.people : ctx.asset.facts.sponsors) ?? [];
  const labels = new Set(facts.map((value) => `${ns}:${slug(value.replace(new RegExp(`^${ns}:`, "i"), ""))}`));
  const evidence = ctx.evidence.filter((ev) => ev.label && normalizeLabel(ev.label).startsWith(`${ns}:`));
  for (const ev of evidence) labels.add(normalizeLabel(ev.label!));
  return { labels: [...labels], evidence };
}

function nearMiss(c: RuleCheck, publishAt: string): string {
  const id = c.rule.id;
  if (c.selector === "UNKNOWN") {
    return `Permission ${id} cannot be confirmed: asset ${c.unknownFacts.join(" and ")} is not recorded in ScorePlay metadata`;
  }
  if (c.window === "EXPIRED") return `Permission ${id} expired on ${c.rule.validUntil} (publish date ${publishAt})`;
  if (c.window === "NOT_YET") return `Permission ${id} only starts on ${c.rule.validFrom} (publish date ${publishAt})`;
  return `Permission ${id} does not cover ${c.intentMisses.join("; ")}`;
}

function evaluateDimension(dim: Dimension, ctx: SegmentContext): Reason[] {
  const checks = ctx.checks.filter((c) => c.rule.dimensions.includes(dim));

  const denies = checks.filter((c) => c.rule.effect === "DENY" && c.selector === "YES" && applies(c));
  if (denies.length > 0) {
    return denies.map((c) => {
      c.triggering.forEach((e) => ctx.used.add(e));
      return reason(ctx, c.rule.id, dim, "DENY", c.rule.explanation, c.triggering);
    });
  }

  const missing: Reason[] = factGaps(dim, ctx).map((msg) => reason(ctx, `fact:${dim}`, dim, "MISSING", msg));

  for (const c of checks) {
    if (c.rule.effect === "DENY" && c.selector === "UNKNOWN" && applies(c)) {
      c.triggering.forEach((e) => ctx.used.add(e));
      missing.push(
        reason(
          ctx,
          c.rule.id,
          dim,
          "MISSING",
          `Restriction ${c.rule.id} may apply but asset ${c.unknownFacts.join(" and ")} is unknown: ${c.rule.explanation}`,
          c.triggering,
        ),
      );
    }
  }

  const permits = checks.filter((c) => c.rule.effect === "PERMIT" && c.selector === "YES" && applies(c));
  if (permits.length === 0) {
    const near = checks.filter((c) => c.rule.effect === "PERMIT" && c.selector !== "NO");
    if (near.length > 0) {
      for (const c of near) missing.push(reason(ctx, c.rule.id, dim, "MISSING", nearMiss(c, ctx.intent.publishAt)));
    } else {
      missing.push(
        reason(ctx, `no-rule:${dim}`, dim, "MISSING", `No rule in policy ${ctx.policy.id} grants ${dim} for this asset and intent`),
      );
    }
  } else if (dim === "people" || dim === "sponsor") {
    const { labels, evidence } = subjects(dim, ctx);
    evidence.forEach((e) => ctx.used.add(e));
    for (const label of labels) {
      const covered = permits.some((c) => c.rule.covers?.some((p) => matchesPattern(label, p)));
      if (!covered) {
        const triggering = evidence.filter((e) => normalizeLabel(e.label!) === label);
        missing.push(
          reason(ctx, `no-rule:${dim}`, dim, "MISSING", `No permission in policy ${ctx.policy.id} covers ${label}`, triggering),
        );
      }
    }
  }

  if (missing.length > 0) return missing;
  return permits.map((c) => {
    c.triggering.forEach((e) => ctx.used.add(e));
    return reason(ctx, c.rule.id, dim, "PERMIT", c.rule.explanation, c.triggering);
  });
}

// ---------- Decisions ----------

/** ALLOWED requires an affirmative PERMIT on every mandatory dimension and nothing else. */
function verdictOf(reasons: Reason[]): Verdict {
  if (reasons.some((r) => r.outcome === "DENY")) return "BLOCKED";
  if (reasons.some((r) => r.outcome === "MISSING")) return "NEEDS_REVIEW";
  const permitted = new Set(reasons.filter((r) => r.outcome === "PERMIT").map((r) => r.dimension));
  return MANDATORY_DIMENSIONS.every((d) => permitted.has(d)) ? "ALLOWED" : "NEEDS_REVIEW";
}

function buildDecision(reasons: Reason[], evidence: Evidence[], policy: Policy, now: Date): Decision {
  const missingFacts = [...new Set(reasons.filter((r) => r.outcome === "MISSING").map((r) => r.explanation))];
  const uniqueEvidence = [
    ...new Map(
      evidence.map((e) => [JSON.stringify([e.scoreplayMediaId, e.start, e.end, e.label, e.observation, e.source]), e]),
    ).values(),
  ];
  return {
    verdict: verdictOf(reasons),
    reasons,
    missingFacts,
    evidence: uniqueEvidence,
    policyVersion: policy.version,
    policyId: policy.id,
    policyFictional: policy.fictional,
    evaluatedAt: now.toISOString(),
  };
}

export function evaluateSegment({ segment, asset, observations, intent, policy, now }: EvaluateSegmentInput): Decision {
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
    intent,
    policy,
    checks: policy.rules.map((rule) => checkRule(rule, asset, evidence, intent, publishAt)),
    used: new Set(),
  };
  const reasons = MANDATORY_DIMENSIONS.flatMap((dim) => evaluateDimension(dim, ctx));
  return buildDecision(reasons, [...ctx.used], policy, now);
}

/** A segment whose ScorePlay asset could not be loaded: every dimension is unknown. */
function unloadedAssetDecision(segment: Segment, policy: Policy, now: Date): Decision {
  const explanation = `ScorePlay asset ${segment.scoreplayMediaId} metadata was not loaded`;
  const reasons: Reason[] = MANDATORY_DIMENSIONS.map((dimension) => ({
    ruleId: "fact:asset",
    dimension,
    outcome: "MISSING",
    explanation,
    scoreplayMediaId: segment.scoreplayMediaId,
    start: segment.start,
    end: segment.end,
  }));
  return buildDecision(reasons, [], policy, now);
}

/**
 * Evaluates every constituent segment independently, then aggregates.
 * Derived edits are evaluated exactly like any other edit — no verdict is inherited from the source.
 */
export function evaluateEdit({ edit, assets, observations, intent, policy, now }: EvaluateEditInput): EditDecision {
  const segments: SegmentDecision[] = edit.segments.map((segment) => {
    const asset = assets[segment.scoreplayMediaId];
    const decision = asset
      ? evaluateSegment({ segment, asset, observations: observations[asset.id] ?? [], intent, policy, now })
      : unloadedAssetDecision(segment, policy, now);
    return { segment, decision };
  });

  const decision = buildDecision(
    segments.flatMap((s) => s.decision.reasons),
    segments.flatMap((s) => s.decision.evidence),
    policy,
    now,
  );
  // Aggregate rule: any BLOCKED → BLOCKED, else any NEEDS_REVIEW → NEEDS_REVIEW, else ALLOWED.
  const verdicts = segments.map((s) => s.decision.verdict);
  decision.verdict = verdicts.includes("BLOCKED")
    ? "BLOCKED"
    : verdicts.includes("NEEDS_REVIEW")
      ? "NEEDS_REVIEW"
      : "ALLOWED";
  return { edit, decision, segments };
}
