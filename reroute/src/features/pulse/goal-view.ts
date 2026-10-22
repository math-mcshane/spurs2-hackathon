import type { PublishIntent } from "@/lib/contracts";
import { MARKETS, PRODUCTS } from "./objective-parser";
import { MarketCodeSchema } from "./types";
import type {
  CampaignStage,
  GoalCampaignView,
  GoalRightsCheck,
  GoalRun,
  GoalView,
  Recommendation,
  RecommendationView,
  RecoveryView,
  RightsIssue,
  RightsPresentation,
} from "./types";

/**
 * Presentation of a goal run. Rights wording is a plain-English rendering of REROUTE's recorded
 * verdict and reasons — PULSE never computes, upgrades or softens a verdict. "Cleared" is reserved
 * for REROUTE ALLOWED under a non-fictional policy for the exact moment and use.
 */

const TOPIC: Record<string, string> = {
  territory: "Territory",
  platform: "Platform",
  usage: "Organic vs sponsored use",
  competition: "Competition licence",
  expiry: "Licence dates",
  people: "People on screen",
  sponsor: "Sponsors and brands on screen",
};
const LICENCE: Record<string, true> = { territory: true, platform: true, usage: true, competition: true, expiry: true };
const PLATFORM: Record<string, string> = { instagram: "Instagram", x: "X", youtube: "YouTube", facebook: "Facebook", tiktok: "TikTok" };

export function describeUse(intent: PublishIntent): string {
  const market = MarketCodeSchema.safeParse(intent.territory);
  const country = market.success ? MARKETS[market.data].label : intent.territory;
  return `${intent.usage === "ORGANIC" ? "Organic" : "Sponsored"} ${PLATFORM[intent.platform] ?? intent.platform} post in ${country} (${intent.territory}) · ${intent.competition}`;
}

/**
 * REROUTE reasons as plain-English topics: dimensions REROUTE explained with the same sentence are
 * one topic (e.g. all licence terms), and each topic lists REROUTE's explanations verbatim.
 */
export function rightsIssues(check: GoalRightsCheck): RightsIssue[] {
  const byExplanation = new Map<string, { outcome: "DENY" | "MISSING"; dimensions: string[] }>();
  for (const r of check.reasons) {
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

export function presentRights(check: GoalRightsCheck | undefined, intent: PublishIntent): RightsPresentation {
  const use = describeUse(check?.intent ?? intent);
  if (!check) {
    return {
      state: "NOT_CHECKED",
      cleared: false,
      headline: "Not checked yet",
      detail: "REROUTE has not evaluated this moment yet. Nothing is cleared until it does.",
      use,
      issues: [],
      missingFacts: [],
    };
  }
  const issues = rightsIssues(check);
  const base = {
    state: check.state,
    use,
    issues,
    missingFacts: check.missingFacts,
    checkedAt: check.checkedAt,
    policyId: check.policyId,
    policyFictional: check.policyFictional,
    rerouteUrl: check.rerouteUrl,
  };
  switch (check.state) {
    case "ALLOWED":
      return check.policyFictional
        ? {
            ...base,
            cleared: false,
            headline: "Allowed under a demo policy — not a real clearance",
            detail: `REROUTE returned ALLOWED, but policy ${check.policyId} is fictional demo data. A real rights policy is required before this can be called cleared.`,
          }
        : { ...base, cleared: true, headline: "Cleared by REROUTE for this exact use", detail: `REROUTE returned ALLOWED under policy ${check.policyId} v${check.policyVersion}.` };
    case "BLOCKED": {
      const denied = issues.filter((i) => i.outcome === "DENY").map((i) => i.topic.toLowerCase());
      return {
        ...base,
        cleared: false,
        headline: "Blocked for this use",
        detail: `REROUTE found a restriction${denied.length ? ` on ${denied.join(", ")}` : ""} that rules this moment out for this use. PULSE cannot override it.`,
      };
    }
    case "NEEDS_REVIEW":
      return {
        ...base,
        cleared: false,
        headline: "Needs a rights review",
        detail: `REROUTE could not confirm ${issues.length} point${issues.length === 1 ? "" : "s"} for this use, so a person has to review it before it can be used. Nothing was found that forbids it outright.`,
      };
  }
}

/** Asset ids vary between candidates; the reason behind them does not. */
const normalize = (s: string) => s.replace(/\b\d{5,}\b/g, "#");

/**
 * When every non-ALLOWED moment REROUTE checked shares open points, switching clips cannot resolve
 * them — say so, in REROUTE's terms.
 */
export function sharedBlocker(checks: readonly GoalRightsCheck[]): string | undefined {
  const open = checks.filter((c) => c.state !== "ALLOWED");
  if (open.length < 2) return undefined;
  const keyed = open.map((c) => new Map(c.reasons.filter((r) => r.outcome !== "PERMIT").map((r) => [`${r.dimension}|${normalize(r.explanation)}`, r.dimension])));
  const common = [...keyed[0].entries()].filter(([k]) => keyed.every((m) => m.has(k))).map(([, d]) => d);
  if (common.length === 0) return undefined;
  const dims = [...new Set(common)];
  const topics = dims.every((d) => LICENCE[d]) && dims.length > 1 ? ["licence terms"] : dims.map((d) => (TOPIC[d] ?? d).toLowerCase());
  return (
    `All ${open.length} moments REROUTE checked share the same open point${topics.length > 1 ? "s" : ""}: ${topics.join(", ")}. ` +
    "Another clip will not resolve this — it needs rights data or a reviewer in REROUTE."
  );
}

function checkFor(recorded: GoalRun["rights"], rec: Recommendation): GoalRightsCheck | undefined {
  const c = recorded[rec.key];
  const seg = c?.edit.segments[0];
  // Only a verdict for exactly this asset and cut counts.
  return c && seg?.scoreplayMediaId === rec.candidate.scoreplayAssetId && seg.start === rec.candidate.startSeconds && seg.end === rec.candidate.endSeconds
    ? c
    : undefined;
}

export function recommendationView(recorded: GoalRun["rights"], rec: Recommendation, intent: PublishIntent): RecommendationView {
  return { ...rec, rights: presentRights(checkFor(recorded, rec), intent) };
}

function campaignStage(run: GoalRun, rights: RightsPresentation, ctaReady: boolean): { stage: CampaignStage; note: string } {
  if (run.approval && run.approval.key === run.selectedKey && rights.cleared) {
    return { stage: "APPROVED", note: `Approved by ${run.approval.by}. Publish it outside PULSE — PULSE never posts or buys ads.` };
  }
  if (rights.cleared) {
    return ctaReady
      ? { stage: "READY_FOR_APPROVAL", note: "Rights cleared by REROUTE and the proposal is complete — ready for human approval." }
      : { stage: "RIGHTS_CLEARED", note: "Rights cleared by REROUTE. Add the club-approved destination URL before approval." };
  }
  const note: Record<RightsPresentation["state"], string> = {
    NOT_CHECKED: "Draft proposal. Next: ask REROUTE whether this exact moment can be used.",
    NEEDS_REVIEW: "Draft proposal. REROUTE needs a rights review before it can move on — or find another way.",
    BLOCKED: "Draft proposal on a blocked moment. Find another way to keep the same goal.",
    ALLOWED: "REROUTE allowed it under a fictional demo policy, so it stays a proposal: a real rights policy is the missing dependency.",
  };
  return { stage: "PROPOSED", note: note[rights.state] };
}

/** `intentFor`: the publish intent REROUTE would be asked about for a moment (labels unchecked moments). */
export function buildGoalView(run: GoalRun, intentFor: (rec: Recommendation) => PublishIntent): GoalView {
  const { pool, rights: recorded, campaign: draft, ...light } = run;
  const view = (r: Recommendation) => recommendationView(recorded, r, intentFor(r));
  const selectedRec = pool.find((r) => r.key === run.selectedKey);

  let campaign: GoalCampaignView | undefined;
  if (draft && selectedRec) {
    const rights = presentRights(checkFor(recorded, selectedRec), draft.rerouteIntent);
    const commerce = run.objective.product && PRODUCTS[run.objective.product.key].commerce;
    const ctaReady = draft.cta.status !== "NOT_CONFIGURED";
    const { stage, note } = campaignStage(run, rights, ctaReady);
    const notLocalized = draft.evidenceLabels.find((l) => l.startsWith("Copy not localized"));
    campaign = {
      ...draft,
      rights,
      stage,
      stageNote: note,
      approval: stage === "APPROVED" ? run.approval : undefined,
      checklist: [
        { item: "Media and exact timestamps", status: "DONE", note: "TwelveLabs moment on a ScorePlay asset." },
        notLocalized
          ? { item: "Localized copy", status: "MISSING", note: notLocalized }
          : { item: "Localized copy", status: "DONE", note: `Written in ${draft.audience.language.toUpperCase()}.` },
        ...(commerce
          ? [
              draft.cta.destination
                ? { item: "Destination URL", status: "DONE" as const, note: draft.cta.destination.source === "CONFIGURED" ? "Configured by the club." : "Entered by you — confirm it is club-approved." }
                : { item: "Destination URL", status: "MISSING" as const, note: "No club-approved store URL yet — add one to enable the call to action." },
              { item: "Product inventory", status: "NOT_CONNECTED" as const, note: "No product feed: the copy makes no stock, price or availability claim." },
            ]
          : []),
        rights.cleared
          ? { item: "Rights clearance", status: "DONE", note: rights.detail }
          : { item: "Rights clearance", status: "MISSING", note: `${rights.headline}. ${rights.detail}` },
        { item: "Performance tracking", status: "NOT_CONNECTED", note: run.objective.measurement.note },
        stage === "APPROVED"
          ? { item: "Human approval", status: "DONE", note: `Approved by ${run.approval!.by}.` }
          : { item: "Human approval", status: "MISSING", note: rights.cleared ? "Waiting for an approver." : "Possible only after rights clearance." },
      ],
    };
  }

  let recovery: RecoveryView | undefined;
  if (run.recovery) {
    const checked = run.recovery.keys.flatMap((k) => pool.find((r) => r.key === k) ?? []).map(view);
    const tried = new Set([run.recovery.forKey, ...run.recovery.keys]);
    const unchecked = pool.filter((r) => !tried.has(r.key) && !checkFor(recorded, r)).slice(0, 3).map(view);
    // Every verdict recorded for this goal, including the moment that triggered the recovery.
    const verdicts = pool.flatMap((r) => checkFor(recorded, r) ?? []);
    recovery = {
      forKey: run.recovery.forKey,
      requestedAt: run.recovery.requestedAt,
      exhausted: run.recovery.exhausted,
      groups: {
        ALLOWED: checked.filter((r) => r.rights.state === "ALLOWED"),
        NEEDS_REVIEW: checked.filter((r) => r.rights.state === "NEEDS_REVIEW"),
        BLOCKED: checked.filter((r) => r.rights.state === "BLOCKED"),
        UNCHECKED: [...checked.filter((r) => r.rights.state === "NOT_CHECKED"), ...unchecked],
      },
      sharedBlocker: sharedBlocker(verdicts),
    };
  }

  const seconds = (to: string) => Math.round((Date.parse(to) - Date.parse(run.submittedAt)) / 100) / 10;
  return {
    run: light,
    recommendations: pool.slice(0, 3).map(view),
    selected: selectedRec && view(selectedRec),
    campaign,
    recovery,
    kpi: {
      label: run.objective.kpi,
      value: null,
      status: run.objective.measurement.status,
      note: `${run.objective.measurement.note} No value is shown until a verified source is connected.`,
    },
    timing: { toRecommendationsSec: seconds(run.resultsAt), toCampaignSec: draft ? seconds(draft.createdAt) : undefined },
  };
}
