/**
 * Rights & Compliance wording, derived ONLY from data the run already holds: the parsed objective, the campaign plan
 * (`goal.campaign?.plan ?? goal.run.plan`), the recommendation, the sponsor check and REROUTE's grouped findings.
 * Nothing here states a fact the data does not contain, and nothing promises that a fix will work.
 */
import { clock } from "../moment-ranking";
import type { GoalPlan, GoalView, RecommendationView } from "../types";
import { channelList, country, displayTitle, usageWord, type Issue } from "./parts";

export const planOf = (goal: GoalView): GoalPlan => goal.campaign?.plan ?? goal.run.plan;

/** Whole seconds of the moment, when TwelveLabs gave both boundaries. */
export function momentSeconds(rec: RecommendationView): number | undefined {
  const { startSeconds: s, endSeconds: e } = rec.candidate;
  return s === undefined || e === undefined ? undefined : Math.max(1, Math.round(e - s));
}

/** True when the recommendation is a whole ScorePlay clip chosen on metadata (no TwelveLabs moment inside it). */
export const metadataOnly = (rec: RecommendationView) => rec.candidate.foundBy !== "TWELVELABS";

/** A human title: the file name without extension or separators, first letter capitalised. */
export function clipTitle(title: string): string {
  const t = displayTitle(title);
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** The card's one line of campaign relevance: "Partner on the kit · 11-second sponsored post". */
export function relevanceLine(goal: GoalView, rec: RecommendationView): string {
  const secs = momentSeconds(rec);
  const usage = usageWord(planOf(goal).usage);
  return `${rec.headline} · ${secs === undefined ? `${usage} post` : `${secs}-second ${usage} post`}`;
}

export const spanLabel = (at: { start: number; end: number }) => `${clock(at.start)}–${clock(at.end)}`;

/** The sponsor check's "15–17 s" as "0:15–0:17"; anything else verbatim. */
export function brandSpan(span: string): string {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*s\s*$/.exec(span);
  return m ? spanLabel({ start: Number(m[1]), end: Number(m[2]) }) : span;
}

const shorten = (text: string, max = 140) => {
  const t = text.trim().replace(/\.$/, "");
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(" "), max - 20))}…`;
};

const list = (items: readonly string[]) =>
  items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;

type Sponsor = NonNullable<GoalView["sponsorContext"]>;

/** The restricted brand the sponsor check saw, if any (a competitor of the club's partners on screen). */
export const restrictedBrand = (sponsor: Sponsor | undefined) => sponsor?.brands.find((b) => b.role === "COMPETING_RESTRICTED");

/** The top problem: DENY before MISSING (`groupIssues` already orders them so). */
const topIssue = (issues: readonly Issue[]) => issues.find((i) => i.outcome === "DENY") ?? issues[0];

/**
 * The restriction in one plain sentence: the restricted brand on screen first, else the top issue — for a licence
 * term, which markets or channels are not covered; otherwise the first observation, shortened.
 */
export function issueSentence(goal: GoalView, issues: readonly Issue[]): string | undefined {
  const brand = restrictedBrand(goal.sponsorContext);
  if (brand) {
    const name = brand.name.charAt(0).toUpperCase() + brand.name.slice(1);
    const where = brand.spans.length ? ` (${brand.spans.map(brandSpan).join(", ")})` : "";
    return brand.certainty === "SCOREPLAY_TAG" && !brand.spans.length
      ? `${name}, not a club partner, is tagged on this clip.`
      : `${name}, not a club partner, appears on screen${where}.`;
  }
  const issue = topIssue(issues);
  if (!issue) return undefined;
  const verb = issue.outcome === "DENY" ? "not permitted" : issue.licence ? "not licensed" : "not confirmed";
  if (issue.topic === "Market") return `${issue.topic}: ${verb} in ${list(issue.territories.map(country))}.`;
  if (issue.topic === "Channel") return `${issue.topic}: ${verb} on ${channelList(issue.channels)}.`;
  const found = issue.found[0]?.text;
  return found ? `${issue.topic}: ${shorten(found)}.` : `${issue.topic}: ${verb}.`;
}

/**
 * What "Fix this clip" will try, before it runs — phrased as an attempt that is re-checked, never as a fix: a timed
 * on-screen finding can be cut around; a market problem limited to some markets can be dropped; otherwise other
 * club footage is tried.
 */
export function fixHint(goal: GoalView, issues: readonly Issue[]): string {
  const brand = restrictedBrand(goal.sponsorContext);
  if (brand?.spans.length) return "remove that segment and re-check.";
  const issue = topIssue(issues);
  const markets = planOf(goal).territories.length;
  if (issue?.topic === "Market" && issue.territories.length < markets) return "drop the unlicensed markets and re-check.";
  return "try other club footage and re-check.";
}
