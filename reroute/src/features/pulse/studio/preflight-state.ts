import type { OpportunityPreflight, RecommendationView } from "../types";

/**
 * Selection-time rights preflight of one opportunity card, as the Studio holds it. Contract between the preflight
 * hook (`use-preflight.ts`) and the Opportunity Studio UI. A state always belongs to the card's CURRENT
 * `preflightBasis`: a result computed for another basis (policy switch, plan change, new cut) is never returned.
 *
 * - `checking`: REROUTE is evaluating this card ("Checking rights…").
 * - `done`: REROUTE's verdict for these inputs — ALLOWED / BLOCKED / NEEDS_REVIEW, verbatim. An early read, not the
 *   campaign's recorded decision and never legal clearance.
 * - `unavailable`: the check failed or timed out; no verdict exists ("Check unavailable"). The campaign's own
 *   "Check rights" remains the fallback.
 */
export type PreflightState =
  | { status: "checking"; startedAt: number }
  | { status: "done"; result: OpportunityPreflight }
  | { status: "unavailable"; message: string };

export type PreflightApi = {
  /** State for the card's current basis; undefined = not requested (e.g. preflight disabled). */
  get(rec: Pick<RecommendationView, "key" | "preflightBasis">): PreflightState | undefined;
  /** Re-runs the check for the card's current basis (after `unavailable`). */
  retry(rec: Pick<RecommendationView, "key" | "preflightBasis">): void;
};
