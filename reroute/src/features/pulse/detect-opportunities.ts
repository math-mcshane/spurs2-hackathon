import type { TopicSignal } from "./signal-adapter";
import type { CommercialState, DetectedOpportunity, FanSignal, ScoreBreakdown, SponsorBrief, Topic } from "./types";

/** Hackathon heuristics (spec §9), not a trained predictor of performance or sales. */
export const WEIGHTS = { fanSignalStrength: 0.4, commercialFit: 0.35, freshness: 0.25 } as const;
export const FRESHNESS_WINDOW_HOURS = 72;

/** Contracted deliverables not yet published per the brief record (PULSE publications counted separately). */
export function openDeliverables(brief: SponsorBrief): number {
  return Math.max(0, (brief.contractedDeliverables ?? 0) - (brief.publishedDeliverables ?? 0));
}

export type BriefMatch = { brief?: SponsorBrief; state: CommercialState; fit: number; rationale: string };

/**
 * Connects a topic to a club-entered brief. A brief is a business objective, never a rights grant.
 * Open contracted deliverables → FULFILLMENT_CANDIDATE; a brief without open obligations → UPSELL_IDEA;
 * no brief → EDITORIAL.
 */
export function matchBrief(topic: Topic, briefs: readonly SponsorBrief[]): BriefMatch {
  const scored = briefs
    .filter((b) => b.club === topic.club)
    .map((brief) => {
      const overlap = brief.topicTags.filter((t) => topic.topicTags.includes(t));
      const picked = topic.sponsorBriefId === brief.id;
      const formatOk = brief.allowedFormats.includes(topic.desiredFormat);
      return { brief, overlap, picked, eligible: picked || (formatOk && overlap.length > 0) };
    })
    .filter((m) => m.eligible)
    .toSorted(
      (a, b) =>
        Number(b.picked) - Number(a.picked) ||
        Number(openDeliverables(b.brief) > 0) - Number(openDeliverables(a.brief) > 0) ||
        b.overlap.length - a.overlap.length ||
        a.brief.id.localeCompare(b.brief.id),
    );

  const best = scored[0];
  if (!best) {
    return { state: "EDITORIAL", fit: 0, rationale: "No sponsor brief matches this topic — brand/editorial suggestion only." };
  }
  const { brief, overlap, picked } = best;
  const ratio = brief.topicTags.length ? overlap.length / brief.topicTags.length : 0;
  const why = picked
    ? `Brief selected by the producer`
    : `Matches ${overlap.length} of ${brief.topicTags.length} brief topics (${overlap.join(", ")}) in an allowed format`;
  const open = openDeliverables(brief);
  if (open > 0) {
    return {
      brief,
      state: "FULFILLMENT_CANDIDATE",
      fit: Math.round(70 + 30 * ratio),
      rationale: `${why}; ${open} of ${brief.contractedDeliverables} contracted deliverables still open.`,
    };
  }
  return {
    brief,
    state: "UPSELL_IDEA",
    fit: Math.round(40 + 30 * ratio),
    rationale: `${why}; no open contracted deliverable — a concept for sales review, not sold inventory.`,
  };
}

/** 100 when just observed, linearly 0 at FRESHNESS_WINDOW_HOURS. */
export function freshnessScore(observedAt: string, clock: Date): number {
  const ageHours = Math.min(FRESHNESS_WINDOW_HOURS, Math.max(0, (clock.getTime() - Date.parse(observedAt)) / 3_600_000));
  return Math.round(100 * (1 - ageHours / FRESHNESS_WINDOW_HOURS));
}

function signalNote(signal: FanSignal, strength: number, max: number): string {
  if (signal.mode === "MANUAL") return "Producer trigger — no fan posts, so no fan-signal strength.";
  return `${signal.sampleCount} sampled post(s) vs ${max} for the strongest topic in this batch → ${strength}.`;
}

export type Clocks = { now: Date; replayClock?: Date };

/**
 * Deterministic: signals + briefs + clocks → scored opportunities. FIXTURE freshness is measured on
 * the replay clock (the demo's simulated "now"); MANUAL freshness on wall time.
 */
export function detectOpportunities(
  items: readonly TopicSignal[],
  briefs: readonly SponsorBrief[],
  clocks: Clocks,
  detectedAt: string,
): DetectedOpportunity[] {
  const maxCount = Math.max(0, ...items.map((i) => i.signal.sampleCount));
  return items.map(({ topic, signal }) => {
    const match = matchBrief(topic, briefs);
    const fanSignalStrength = maxCount > 0 ? Math.round((100 * signal.sampleCount) / maxCount) : 0;
    const clock = signal.mode === "FIXTURE" && clocks.replayClock ? clocks.replayClock : clocks.now;
    const freshness = freshnessScore(signal.observedAt, clock);
    const score: ScoreBreakdown = {
      priority: Math.round(
        WEIGHTS.fanSignalStrength * fanSignalStrength + WEIGHTS.commercialFit * match.fit + WEIGHTS.freshness * freshness,
      ),
      fanSignalStrength,
      commercialFit: match.fit,
      freshness,
      notes: {
        fanSignalStrength: signalNote(signal, fanSignalStrength, maxCount),
        commercialFit: match.rationale,
        freshness: `Latest sample ${signal.observedAt} measured against ${
          clock === clocks.replayClock ? "the replay clock" : "wall time"
        } ${clock.toISOString()} (${FRESHNESS_WINDOW_HOURS} h window).`,
      },
    };
    return {
      id: `opp-${topic.key}`,
      club: topic.club,
      game: topic.game,
      focus: topic.focus,
      headline: topic.headline,
      angle: topic.angle,
      interestSummary: topic.interestSummary,
      signal,
      targetAudienceCohort: topic.cohort,
      desiredFormat: topic.desiredFormat,
      sponsorBriefId: match.brief?.id,
      commercialState: match.state,
      commercialRationale: match.rationale,
      contentTraits: topic.contentTraits,
      hooks: topic.hooks,
      score,
      evidenceMode: signal.mode,
      discovery: topic.scoreplay,
      semanticQuery: topic.semanticQuery,
      detectedAt,
    };
  });
}
