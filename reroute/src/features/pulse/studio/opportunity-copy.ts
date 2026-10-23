/**
 * Rights & Compliance wording, derived ONLY from data the run already holds: the parsed objective, the campaign plan
 * (`goal.campaign?.plan ?? goal.run.plan`), the recommendation, the sponsor check and REROUTE's grouped findings.
 * Nothing here states a fact the data does not contain, and nothing promises that a fix will work.
 */
import { DEFAULT_LIMITS } from "@/lib/rights/recovery/limits";
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
  const at = spanSeconds(span);
  return at ? spanLabel(at) : span;
}

/** "15–17 s" → { start: 15, end: 17 }. */
function spanSeconds(span: string): { start: number; end: number } | undefined {
  const m = /^\s*(\d+(?:\.\d+)?)\s*[–-]\s*(\d+(?:\.\d+)?)\s*s\s*$/.exec(span);
  return m ? { start: Number(m[1]), end: Number(m[2]) } : undefined;
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

/** The restricted brand the sponsor check saw, if any (a rule restricts it for this use). */
export const restrictedBrand = (sponsor: Sponsor | undefined) => sponsor?.brands.find((b) => b.role === "COMPETING_RESTRICTED");

/** A club partner on screen that the rules don't describe: a contract question, never a conflict. */
const clubPartnerBrand = (sponsor: Sponsor | undefined) => sponsor?.brands.find((b) => b.role === "CLUB_PARTNER");

/** The top problem: DENY before MISSING (`groupIssues` already orders them so). */
const topIssue = (issues: readonly Issue[]) => issues.find((i) => i.outcome === "DENY") ?? issues[0];

const capital = (name: string) => name.charAt(0).toUpperCase() + name.slice(1);
const where = (brand: Sponsor["brands"][number]) => (brand.spans.length ? ` (${brand.spans.map(brandSpan).join(", ")})` : "");

/**
 * The restriction in one plain sentence: the restricted brand on screen first; then, when nothing is denied, a club
 * partner the rules don't list; else the top issue — for a licence term, which markets or channels are not covered;
 * otherwise the first observation, shortened.
 */
export function issueSentence(goal: GoalView, issues: readonly Issue[]): string | undefined {
  const brand = restrictedBrand(goal.sponsorContext);
  if (brand) {
    const rule = brand.ruleId ? ` (${brand.ruleId})` : "";
    return brand.certainty === "SCOREPLAY_TAG" && !brand.spans.length
      ? `${capital(brand.name)} is tagged on this clip — restricted for this use under these illustrative rules${rule}.`
      : `${capital(brand.name)} appears on screen${where(brand)} — restricted for this use under these illustrative rules${rule}.`;
  }
  const denied = issues.some((i) => i.outcome === "DENY");
  const target = goal.sponsorContext?.target;
  if (target?.relationship === "UNKNOWN" && !denied) {
    const known = target.clubPartner ? ` — ${target.clubPartner} —` : ",";
    return `This post promotes ${target.name}${known} but these illustrative rules don't describe that relationship, so a reviewer confirms the contract; it is not a conflict.`;
  }
  const partner = clubPartnerBrand(goal.sponsorContext);
  if (partner && !denied) {
    return `${capital(partner.name)} appears on screen${where(partner)} — ${partner.clubPartner ?? "a club partner"}. These illustrative rules don't list it, so a reviewer confirms the contract; it is not a conflict.`;
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
 * Whether cutting the brand's seconds (with the recovery margin) would still leave a postable clip, by the same
 * minimums "Find a way" applies — so the hint never suggests a cut that would be rejected for leaving too little.
 * Whether the cut clears the use is still decided only by the independent re-check.
 */
function cutLeavesEnough(goal: GoalView, spans: readonly string[]): boolean {
  const media = goal.campaign?.media;
  if (!media) return false;
  const kept = goal.campaign?.edl?.retained ?? [{ start: media.startSeconds, end: media.endSeconds }];
  const margin = DEFAULT_LIMITS.boundaryMarginSec;
  const removed = spans.flatMap((s) => spanSeconds(s) ?? []).map((r) => ({ start: r.start - margin, end: r.end + margin }));
  const total = kept.reduce((n, k) => n + (k.end - k.start), 0);
  const left = kept.reduce((n, k) => {
    const cut = removed.reduce((c, r) => c + Math.max(0, Math.min(k.end, r.end) - Math.max(k.start, r.start)), 0);
    return n + Math.max(0, k.end - k.start - cut);
  }, 0);
  return left >= Math.max(DEFAULT_LIMITS.minPostSec, DEFAULT_LIMITS.minRetainedRatio * total);
}

/**
 * What "Fix this clip" will try, before it runs — phrased as an attempt that is re-checked, never as a fix: a timed
 * restricted brand is cut around only when enough footage would remain; a partner the rules don't describe (the
 * target sponsor, or a club partner on screen) is a question for the rights team — no cut or other clip settles it;
 * a market problem limited to some markets can be dropped; otherwise other club footage is tried.
 */
export function fixHint(goal: GoalView, issues: readonly Issue[]): string {
  const brand = restrictedBrand(goal.sponsorContext);
  if (brand?.spans.length && cutLeavesEnough(goal, brand.spans)) return "remove those seconds and re-check.";
  const denied = issues.some((i) => i.outcome === "DENY");
  if (!denied && goal.sponsorContext?.target?.relationship === "UNKNOWN") {
    return "ask the rights team to confirm the partnership — a different cut or clip doesn't change it.";
  }
  if (!denied && clubPartnerBrand(goal.sponsorContext)) {
    return "ask the rights team to confirm the partner contract — no cut is proposed for a club partner.";
  }
  const issue = topIssue(issues);
  const markets = planOf(goal).territories.length;
  if (issue?.topic === "Market" && issue.territories.length < markets) return "drop the unlicensed markets and re-check.";
  return "try other club footage and re-check.";
}
