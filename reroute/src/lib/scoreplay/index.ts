import type { ScorePlayClient } from "@/lib/contracts";
import { ScorePlayHttpClient } from "./client";

export { SCOREPLAY_TAXONOMY } from "./taxonomy";
export {
  applyWriteback,
  liveRefusal,
  planWriteback,
  policyKind,
  toScorePlayActions,
  writebackMode,
  writebackTargets,
  type MediaReadBack,
  type PlannedAction,
} from "./writeback";

let client: ScorePlayHttpClient | undefined;

/** Server-only. Env is read per request, so a missing key surfaces as AppError NOT_CONFIGURED on first call. */
export function getScorePlayHttpClient(): ScorePlayHttpClient {
  client ??= new ScorePlayHttpClient();
  return client;
}

/** Read seam used by rights/context code (search + get). */
export function getScorePlayClient(): ScorePlayClient {
  return getScorePlayHttpClient();
}
