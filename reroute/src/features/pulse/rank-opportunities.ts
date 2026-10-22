import type {
  DetectedOpportunity,
  LedgerEntry,
  MediaLookup,
  OpportunityView,
  RightsState,
} from "./types";

/** Rights gate first: a high trend score never lifts an opportunity above a better rights verdict. */
const RIGHTS_TIER: Record<RightsState, number> = { ALLOWED: 0, NOT_CHECKED: 1, NEEDS_REVIEW: 1, BLOCKED: 2 };

export const GATE: Record<RightsState, OpportunityView["gate"]> = {
  ALLOWED: "RIGHTS_READY",
  NOT_CHECKED: "NEEDS_CLEARANCE",
  NEEDS_REVIEW: "NEEDS_CLEARANCE",
  BLOCKED: "BLOCKED",
};

/** Joins detection, media lookup and ledger. Rights state comes only from a recorded REROUTE check. */
export function buildView(detected: DetectedOpportunity, media: MediaLookup | undefined, ledger: LedgerEntry | undefined): OpportunityView {
  const entry: LedgerEntry = ledger ?? { status: "DETECTED" };
  const rightsState: RightsState = entry.rights?.state ?? "NOT_CHECKED";
  const deliverableState: OpportunityView["deliverableState"] =
    detected.commercialState !== "FULFILLMENT_CANDIDATE"
      ? "NONE"
      : entry.status === "PUBLISHED" && entry.publishEvidenceUrl
        ? "FULFILLED"
        : entry.status === "APPROVED"
          ? "DELIVERABLE_READY"
          : "OPEN";
  return {
    ...detected,
    status: entry.status,
    rightsState,
    gate: GATE[rightsState],
    deliverableState,
    media,
    ledger: entry,
  };
}

/**
 * Active before dismissed; then rights tier; then the objective's market score when a business
 * objective is active, else editorial priority (commercial fit + fan signal + freshness).
 */
export function rankOpportunities(views: readonly OpportunityView[]): OpportunityView[] {
  return views.toSorted(
    (a, b) =>
      Number(a.status === "DISMISSED") - Number(b.status === "DISMISSED") ||
      RIGHTS_TIER[a.rightsState] - RIGHTS_TIER[b.rightsState] ||
      (b.market?.score ?? b.score.priority) - (a.market?.score ?? a.score.priority) ||
      b.score.commercialFit - a.score.commercialFit ||
      a.id.localeCompare(b.id),
  );
}
