/**
 * TwelveLabs analysis-run identifiers (`Evidence.analysisRun`) and their user-facing labels. Client-safe: no data,
 * no server imports — UI code imports labels from here, never from `recorded-runs.ts` (which bundles recorded data).
 */

/** The product's own Pegasus analysis (live, or replayed from the observation cache). */
export const PRODUCT_RUN = "pegasus:product";
/** The second, independent Pegasus run recorded during the 2026-10-23 media audit (`recorded-runs.ts`). */
export const AUDIT_RUN = "pegasus:audit-2026-10-23";

/** Human label for the run that produced a piece of evidence; evidence without a run predates tagging (product run). */
export function analysisRunLabel(run?: string): string {
  if (!run || run === PRODUCT_RUN) return "TwelveLabs video analysis";
  if (run === AUDIT_RUN) return "TwelveLabs video analysis — second run (recorded 23 Oct 2026)";
  return `TwelveLabs video analysis (${run})`;
}
