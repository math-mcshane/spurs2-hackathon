import type { VideoIntelligence } from "@/lib/contracts";
import { TwelveLabsVideoIntelligence } from "./client";

export { TwelveLabsVideoIntelligence } from "./client";

let instance: TwelveLabsVideoIntelligence | undefined;

/** Singleton (keeps the in-memory video-id → custom_id cache). Throws NOT_CONFIGURED without keys. */
export function getVideoIntelligence(): VideoIntelligence {
  instance ??= new TwelveLabsVideoIntelligence();
  return instance;
}
