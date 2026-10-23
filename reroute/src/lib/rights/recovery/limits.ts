/** How much of a moment a cut must keep to be worth posting. Pure (no imports): the Studio's fix hint reads it too. */
export interface RecoveryLimits {
  /** Shortest cut worth posting (seconds). */
  minPostSec: number;
  /** A trim must keep at least this share of the selected moment. */
  minRetainedRatio: number;
  /** Kept pieces shorter than this are dropped as flashes. */
  minPieceSec: number;
  /** Safety margin added on both sides of AI-observed boundaries (their timestamps are coarse). */
  boundaryMarginSec: number;
}

export const DEFAULT_LIMITS: RecoveryLimits = { minPostSec: 3, minRetainedRatio: 0.4, minPieceSec: 1, boundaryMarginSec: 0.5 };
