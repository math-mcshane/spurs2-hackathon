/**
 * Opportunity Studio wording, derived ONLY from data the run already holds: the parsed objective, the campaign plan
 * (`goal.campaign?.plan ?? goal.run.plan`), the recommendation (headline, why, TwelveLabs matches, ScorePlay
 * candidate) and REROUTE's preflight. Nothing here states a fact the data does not contain (no scorer, minute or
 * result), and nothing promises that a resolution will work.
 */
import { CLUBS } from "../clubs";
import { clock } from "../moment-ranking";
import type { GoalPlan, GoalView, OpportunityPreflight, PreflightFinding, Product, RecommendationView } from "../types";
import { CHANNEL_LABEL, channelList, country, displayTitle, usageWord } from "./parts";

/** The commercial frame of the objective, as an editorial kicker. */
const ANGLE: Record<Product, string> = {
  sponsor: "Sponsor activation",
  jersey: "Shirt sales",
  merch: "Merchandise",
  tickets: "Ticket sales",
  engagement: "Fan engagement",
  followers: "Audience growth",
  subscriptions: "Subscriptions",
};
const USAGE_ANGLE: Record<string, string> = { SPONSORED: "Partner post", COMMERCIAL: "Commercial post", EDITORIAL: "Editorial post" };

export const planOf = (goal: GoalView): GoalPlan => goal.campaign?.plan ?? goal.run.plan;

/** "United Kingdom" or "7 markets". */
export function audienceWhere(plan: GoalPlan): string {
  return plan.territories.length === 1 ? country(plan.territories[0]) : `${plan.territories.length} markets`;
}

/** "Sponsor activation · United Kingdom". */
export function angleKicker(goal: GoalView): string {
  const plan = planOf(goal);
  const product = goal.run.objective.product?.key;
  return `${product ? ANGLE[product] : (USAGE_ANGLE[plan.usage] ?? "Social post")} · ${audienceWhere(plan)}`;
}

/** Whole seconds of the moment, when TwelveLabs gave both boundaries. */
export function momentSeconds(rec: RecommendationView): number | undefined {
  const { startSeconds: s, endSeconds: e } = rec.candidate;
  return s === undefined || e === undefined ? undefined : Math.max(1, Math.round(e - s));
}

const article = (word: string) => (/^(8|11|18|[aeiou])/i.test(word) ? "an" : "a");

/** "Partner on the kit — an 11-second sponsored post for fans in United Kingdom". */
export function opportunityHeadline(goal: GoalView, rec: RecommendationView): string {
  const plan = planOf(goal);
  const secs = momentSeconds(rec);
  const kind = secs === undefined ? `${usageWord(plan.usage)} post` : `${secs}-second ${usageWord(plan.usage)} post`;
  return `${rec.headline} — ${article(kind)} ${kind} for fans in ${audienceWhere(plan)}`;
}

/** True when the recommendation is a whole ScorePlay clip chosen on metadata (no TwelveLabs moment inside it). */
export const metadataOnly = (rec: RecommendationView) => rec.candidate.foundBy !== "TWELVELABS";

/** The proposed post: what is cut, where it runs; then PULSE's own packaging line for the objective. */
export function postConcept(goal: GoalView, rec: RecommendationView): { cut: string; action: string } {
  const plan = planOf(goal);
  const c = rec.candidate;
  if (metadataOnly(rec)) {
    const secs = momentSeconds(rec) ?? 0;
    const cut =
      secs <= 20
        ? `Use the whole ${secs}-second clip “${displayTitle(c.title)}” for ${channelList(plan.channels)}.`
        : `Trim the ${secs}-second clip “${displayTitle(c.title)}” for ${channelList(plan.channels)} — no moment inside it has been located yet.`;
    return { cut, action: rec.why.action };
  }
  const span = `${clock(c.startSeconds ?? 0)}–${clock(c.endSeconds ?? c.startSeconds ?? 0)}`;
  return { cut: `Cut ${span} of “${displayTitle(c.title)}” for ${channelList(plan.channels)}.`, action: rec.why.action };
}

/** Why PULSE recommends it, in one line: the objective reason of the strongest matched visual intent. */
export function recommendationReason(goal: GoalView, rec: RecommendationView): string {
  const top = [...rec.matches].sort((a, b) => a.rank - b.rank)[0];
  const why = goal.run.intents.find((i) => i.key === top?.intent)?.why;
  return why ? `${why}.` : rec.why.opportunity;
}

/** What was matched and where: "Celebration 0:15–0:20 · Partner on the kit 0:15–0:20" (deduplicated by label); tags only for metadata clips. */
export function matchEvidence(rec: RecommendationView): string {
  const seen = new Set<string>();
  return rec.matches
    .filter((m) => !seen.has(m.label) && seen.add(m.label))
    .map((m) => (metadataOnly(rec) ? m.label : `${m.label} ${clock(m.start)}–${clock(m.end)}`))
    .join(" · ");
}

export const evidenceSource = (rec: RecommendationView) =>
  metadataOnly(rec) ? "ScorePlay tags · not visually analysed" : "Machine-observed by TwelveLabs";

/** ScorePlay context: club v match · season · competition. */
export function scorePlayContext(goal: GoalView, rec: RecommendationView): string {
  const club = [CLUBS[goal.run.club].label, goal.run.match && `v ${goal.run.match}`].filter(Boolean).join(" ");
  return [club, rec.season, rec.candidate.competition].filter(Boolean).join(" · ");
}

export const spanLabel = (at: { start: number; end: number }) => `${clock(at.start)}–${clock(at.end)}`;

/** DENY first (the schema orders them so), else the first finding. */
export const topFinding = (p: OpportunityPreflight): PreflightFinding | undefined => p.findings.find((f) => f.outcome === "DENY") ?? p.findings[0];

const list = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

/**
 * What PULSE will try for a restricted opportunity, from REROUTE's own scope and licence gap — phrased as an attempt
 * that is re-checked, never as a fix. Undefined when the preflight is not BLOCKED.
 */
export function resolutionHint(p: OpportunityPreflight): string | undefined {
  if (p.verdict !== "BLOCKED") return undefined;
  const at = topFinding(p)?.at;
  const clip = at
    ? `PULSE will try an edit plan that cuts around ${spanLabel(at)}, or other club footage, and re-check it.`
    : "PULSE will try other club footage and re-check it.";
  if (p.licenceGap) {
    const gaps = [...p.licenceGap.territories.map(country), ...p.licenceGap.platforms.map((x) => CHANNEL_LABEL[x] ?? x)];
    const licence = `Only a licence request can open ${gaps.length ? list(gaps) : "these uses"} — PULSE can prepare one; nothing changes until the rights holder grants it.`;
    return p.scope === "CLIP" || p.scope === "MIXED" ? `${clip} ${licence}` : licence;
  }
  const campaign = p.blockedTerritories.length
    ? `PULSE will try narrowing the plan without ${list(p.blockedTerritories.map(country))} and re-check the remaining markets.`
    : "PULSE will try narrowing the channels or the use and re-check the plan.";
  if (p.scope === "CAMPAIGN") return campaign;
  if (p.scope === "MIXED") return `${clip} ${campaign}`;
  return clip;
}
