import { TwelveLabsVideoIntelligence } from "./client";
import { readTwelveLabsConfig } from "./config";

export { TwelveLabsVideoIntelligence, memoryObservationStore, type ObservationStore, type SearchResult } from "./client";
export { readTwelveLabsConfig, TwelveLabsConfigError, type TwelveLabsConfig } from "./config";

const instances = new Map<string, TwelveLabsVideoIntelligence>();

/**
 * One instance per resolved (key variable, index) — not per raw club string, so arbitrary club values from a
 * request cannot multiply clients or bypass the shared in-flight/failure caches. Throws NOT_CONFIGURED without keys.
 */
export function getVideoIntelligence(club?: string): TwelveLabsVideoIntelligence {
  const config = readTwelveLabsConfig({ club });
  const key = `${config.keyVariable}\u0000${config.indexId}`;
  let instance = instances.get(key);
  if (!instance) {
    instance = new TwelveLabsVideoIntelligence({ club, config });
    instances.set(key, instance);
  }
  return instance;
}
