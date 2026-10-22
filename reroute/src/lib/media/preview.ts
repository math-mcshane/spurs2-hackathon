import { isVideoPreviewEnabled } from "@/features/pulse/flags";
import { defaultScorePlayHttp, getMedia, type ScorePlayHttp } from "@/features/pulse/server/scoreplay-discovery";
import { createTwelveLabsSdk, videoStream, type TwelveLabsSdk } from "@/features/pulse/server/twelvelabs-moments";
import type { Preview } from "@/features/pulse/types";
import { isEvidenceLinkable, type MediaRef } from "@/lib/contracts";
import { mapMediaToAsset } from "@/lib/scoreplay/map";
import { readTwelveLabsConfig } from "@/lib/twelvelabs/config";
import { demoReplayEnabled } from "./replay";

/** Stream URLs may be signed; resolve them at view time and keep them in memory only, briefly. */
export const PREVIEW_TTL_MS = 5 * 60_000;

export type PreviewDeps = { scoreplay: ScorePlayHttp; twelvelabs(): { sdk: TwelveLabsSdk; indexId: string }; now?: () => number };

const cache = new Map<string, { at: number; preview: Promise<Preview | undefined> }>();

function defaultDeps(club?: string): PreviewDeps {
  return {
    scoreplay: defaultScorePlayHttp(),
    twelvelabs: () => {
      const config = readTwelveLabsConfig({ club });
      return { sdk: createTwelveLabsSdk(config.apiKey), indexId: config.indexId };
    },
  };
}

async function resolve(ref: MediaRef, deps: PreviewDeps): Promise<Preview | undefined> {
  if (ref.scoreplayMediaId) {
    try {
      const proxy = mapMediaToAsset(await getMedia(deps.scoreplay, ref.scoreplayMediaId), []).previewUrl;
      if (proxy?.startsWith("https://")) return { source: "SCOREPLAY_PROXY", url: proxy, hls: /\.m3u8(\?|$)/.test(proxy) };
    } catch (err) {
      console.warn(`[media] ScorePlay preview lookup failed for ${ref.scoreplayMediaId}:`, err instanceof Error ? err.message : err);
    }
  }
  // A TwelveLabs stream is shown for a ScorePlay asset only through a linkable identity.
  if (!isEvidenceLinkable(ref)) return undefined;
  try {
    const { sdk, indexId } = deps.twelvelabs();
    const hls = await videoStream(sdk, indexId, ref.twelvelabsVideoId!);
    return hls ? { source: "TWELVELABS_STREAM", url: hls, hls: true } : undefined;
  } catch (err) {
    console.warn(`[media] TwelveLabs preview lookup failed for ${ref.twelvelabsVideoId}:`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

/**
 * Authorized playable reference for a MediaRef — the ScorePlay proxy when it is https, else the TwelveLabs
 * HLS stream of a linkable ref — or undefined (also when PULSE_VIDEO_PREVIEW=off, and always under
 * DEMO_REPLAY: previews are never recorded). Never persisted: cached in memory for PREVIEW_TTL_MS.
 * Nothing is downloaded.
 */
export function previewFor(ref: MediaRef, opts: { club?: string; deps?: PreviewDeps } = {}): Promise<Preview | undefined> {
  if (!isVideoPreviewEnabled() || demoReplayEnabled()) return Promise.resolve(undefined);
  const deps = opts.deps ?? defaultDeps(opts.club);
  const now = (deps.now ?? Date.now)();
  const key = `${ref.twelvelabsIndexId ?? ""}|${ref.scoreplayMediaId ?? ""}|${isEvidenceLinkable(ref) ? ref.twelvelabsVideoId : ""}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < PREVIEW_TTL_MS) return hit.preview;
  const preview = resolve(ref, deps);
  cache.set(key, { at: now, preview });
  return preview;
}
