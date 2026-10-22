import { CLUBS } from "./clubs";
import { PRODUCTS } from "./objective-parser";
import type { MarketAnalysis, MarketFit, OpportunityView, ParsedObjective, Product } from "./types";

/** Hackathon heuristics, shown to the user; not a trained predictor of sales. */
export const MARKET_WEIGHTS = { localInterest: 0.45, objectiveFit: 0.35, mediaAvailability: 0.2 } as const;

/** How well each kind of content serves each product objective (1 = the product is on screen). */
export const PRODUCT_TRAITS: Record<Product, Partial<Record<string, number>>> = {
  jersey: { "player-spotlight": 1, team: 0.5, highlight: 0.4, celebration: 0.4 },
  merch: { "player-spotlight": 0.8, team: 0.8, celebration: 0.6, highlight: 0.4 },
  tickets: { matchday: 1, celebration: 0.7, team: 0.6, highlight: 0.4 },
  engagement: { highlight: 1, celebration: 0.8, "player-spotlight": 0.8, skill: 0.7, matchday: 0.6, team: 0.5, interview: 0.3 },
  followers: { highlight: 1, "player-spotlight": 0.8, skill: 0.6, celebration: 0.6 },
  subscriptions: { highlight: 1, matchday: 0.7, skill: 0.6 },
  sponsor: { matchday: 1, celebration: 0.7, highlight: 0.6 },
};

const READY_MAX_SEC = 20;

/**
 * Market: 0 at or below the usual level, 100 at 8× (log scale), discounted when the rise is within
 * noise. Global: half volume (vs the biggest topic), half that same momentum score.
 */
export function localInterestScore(a: MarketAnalysis): number {
  const significance = a.z >= 3 ? 1 : a.z >= 2 ? 0.6 : 0.3;
  const momentum = a.lift <= 1 ? 0 : 100 * Math.min(1, Math.log2(a.lift) / 3) * significance;
  return Math.round(a.market.code === "GLOBAL" ? 0.5 * 100 * a.globalVolumeShare + 0.5 * momentum : momentum);
}

function whyText(a: MarketAnalysis): string {
  const m = a.market.label;
  if (a.market.code === "GLOBAL") {
    return (
      `Worldwide conversation: ${a.current.toLocaleString("en-US")} mentions/week (${Math.round(a.globalVolumeShare * 100)}% of the biggest topic), ` +
      `${a.lift}× its usual level. A global objective favours large, rising conversations.`
    );
  }
  if (a.underTheRadar) {
    return (
      `${m} conversation is ${a.lift}× its usual weekly level (${a.current} vs ${a.baseline}) while global interest is ${a.globalInterest.toLowerCase()} ` +
      `(${a.globalCurrent.toLocaleString("en-US")} mentions/week). ${m}'s share of the conversation went from ${(a.shareUsual * 100).toFixed(1)}% to ${(a.shareNow * 100).toFixed(1)}% — ` +
      `a regional trend that global totals hide.`
    );
  }
  if (a.momentum === "HIGH" || a.momentum === "MEDIUM") {
    return `${m} conversation is ${a.lift}× usual, but global interest is ${a.globalInterest.toLowerCase()} too — demand is real, not under the radar.`;
  }
  const level = a.momentum === "LOW" ? `only slightly above its usual level (${a.lift}×)` : `at its usual level (${a.lift}×)`;
  return `${m} conversation is ${level}; any recommendation rests on objective fit and available footage, not on local demand.`;
}

function nextAction(view: OpportunityView, objective: ParsedObjective): string {
  const code = objective.market?.code;
  const n = view.media?.candidates.length ?? 0;
  if (view.status === "DISMISSED") return "Dismissed by the producer.";
  if (view.status === "PUBLISHED") return "Published. Sales attribution is not connected — no sales effect is claimed.";
  if (view.status === "APPROVED") return "Publish outside PULSE, then record the post URL.";
  if (n === 0) return "No ScorePlay clip found — search ScorePlay or add footage before anything goes to REROUTE.";
  if (!view.ledger.handoff) return `Pick one of ${n} ScorePlay clip(s), draft the campaign, then open it in REROUTE${code ? ` for territory ${code}` : ""}.`;
  if (view.rightsState === "ALLOWED") return "REROUTE says ALLOWED — approve as producer.";
  return `REROUTE verdict ${view.rightsState} — resolve in REROUTE, then re-check.`;
}

/**
 * Scores one opportunity against the active objective: local interest (market analysis),
 * objective fit (content traits × product, same club), media availability (ScorePlay candidates).
 * Purely explanatory; the rights gate still ranks ahead of this score.
 */
export function marketFit(view: OpportunityView, objective: ParsedObjective, analysis: MarketAnalysis | undefined): MarketFit {
  const localInterest = analysis ? localInterestScore(analysis) : 0;
  const localNote = !analysis
    ? objective.scope === "UNSPECIFIED"
      ? "No market in the objective — state one (e.g. “in Mexico” or “global”) to measure demand."
      : `No signal data for this topic ${objective.market ? `in ${objective.market.label}` : "worldwide"}; nothing is estimated.`
    : analysis.market.code === "GLOBAL"
      ? `${Math.round(analysis.globalVolumeShare * 100)}% of top-topic volume, ${analysis.lift}× usual (z = ${analysis.z}) → ${localInterest}.`
      : `${analysis.lift}× usual (z = ${analysis.z}, momentum ${analysis.momentum}, confidence ${analysis.confidence}) → ${localInterest}.`;

  let objectiveFit: number;
  let fitNote: string;
  if (objective.club && objective.club !== view.club) {
    objectiveFit = 0;
    fitNote = `Objective is for ${CLUBS[objective.club].label}; this is ${CLUBS[view.club].label} content.`;
  } else if (!objective.product) {
    objectiveFit = 50;
    fitNote = "No product in the objective — neutral fit.";
  } else {
    const weights = PRODUCT_TRAITS[objective.product.key];
    const best = view.contentTraits
      .map((t) => ({ t, w: weights[t] ?? 0 }))
      .reduce<{ t?: string; w: number }>((a, b) => (b.w > a.w ? b : a), { w: 0 });
    objectiveFit = Math.round(100 * best.w);
    fitNote = best.t
      ? `“${best.t}” content counts ×${best.w} toward ${PRODUCTS[objective.product.key].label.toLowerCase()}.`
      : `Content (${view.contentTraits.join(", ") || "untagged"}) does not serve ${PRODUCTS[objective.product.key].label.toLowerCase()}.`;
  }

  // Video evidence quality: a TwelveLabs moment (exact timecodes) beats a ScorePlay metadata match.
  const candidates = view.media?.candidates ?? [];
  const moment = candidates.some((c) => c.foundBy === "TWELVELABS");
  const ready = candidates.some((c) => c.durationSec !== undefined && c.durationSec <= READY_MAX_SEC);
  const mediaAvailability = candidates.length === 0 ? 0 : moment ? 100 : ready ? 80 : 60;
  const longest = Math.max(0, ...candidates.map((c) => c.durationSec ?? 0));
  const mediaNote =
    candidates.length === 0
      ? "No ScorePlay video found."
      : moment
        ? `TwelveLabs found a matching moment (exact timecodes) in ${candidates.filter((c) => c.foundBy === "TWELVELABS").length} ScorePlay video(s).`
        : ready
          ? `${candidates.length} ScorePlay video(s) by metadata, at least one ready-length (≤ ${READY_MAX_SEC} s); no video-intelligence moment.`
          : `${candidates.length} ScorePlay video(s) by metadata, all need cutting to 12–15 s (longest ${Math.round(longest)} s); no video-intelligence moment.`;

  const score = Math.round(
    MARKET_WEIGHTS.localInterest * localInterest +
      MARKET_WEIGHTS.objectiveFit * objectiveFit +
      MARKET_WEIGHTS.mediaAvailability * mediaAvailability,
  );
  return {
    objective: objective.summary,
    analysis,
    localInterest,
    objectiveFit,
    mediaAvailability,
    score,
    label: !analysis ? "NO_MARKET_DATA" : score >= 70 ? "STRONG" : score >= 45 ? "POSSIBLE" : "WEAK",
    notes: { localInterest: localNote, objectiveFit: fitNote, mediaAvailability: mediaNote },
    why: analysis ? `${whyText(analysis)} ${fitNote}` : `${localNote} ${fitNote}`,
    proposedContent: `${view.angle}${
      objective.market
        ? ` Target: ${objective.market.label} (REROUTE territory ${objective.market.code}).`
        : objective.scope === "GLOBAL"
          ? " Target: global audience — REROUTE checks one territory per decision; check each further territory before posting there."
          : ""
    }`,
    nextAction: nextAction(view, objective),
  };
}
