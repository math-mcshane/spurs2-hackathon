import { TwelveLabsVideoIntelligence } from "./client";

export { TwelveLabsVideoIntelligence, memoryObservationStore, type ObservationStore, type SearchResult } from "./client";
export { readTwelveLabsConfig, TwelveLabsConfigError, type TwelveLabsConfig } from "./config";

const instances = new Map<string, TwelveLabsVideoIntelligence>();

/** One instance per club (its index), sharing lib/media's resolver cache. Throws NOT_CONFIGURED without keys. */
export function getVideoIntelligence(club?: string): TwelveLabsVideoIntelligence {
  const key = club ?? "";
  let instance = instances.get(key);
  if (!instance) {
    instance = new TwelveLabsVideoIntelligence({ club });
    instances.set(key, instance);
  }
  return instance;
}
