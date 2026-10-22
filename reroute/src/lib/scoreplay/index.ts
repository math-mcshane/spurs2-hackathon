import type { ScorePlayClient } from "@/lib/contracts";
import { ScorePlayHttpClient } from "./client";

export type { MediaReadBack } from "./writeback";
export { SCOREPLAY_TAXONOMY } from "./taxonomy";

let client: ScorePlayHttpClient | undefined;

/** Server-only. Env is read per request, so a missing key surfaces as AppError NOT_CONFIGURED on first call. */
export function getScorePlayClient(): ScorePlayClient {
  client ??= new ScorePlayHttpClient();
  return client;
}
