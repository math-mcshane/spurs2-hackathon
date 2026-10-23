import { z } from "zod";
import { isMediaPreviewEnabled } from "@/features/pulse/flags";
import { defaultScorePlayHttp, getMedia, type ScorePlayHttp } from "@/features/pulse/server/scoreplay-discovery";
import { createTwelveLabsSdk, videoStream, type TwelveLabsSdk } from "@/features/pulse/server/twelvelabs-moments";
import type { Preview } from "@/features/pulse/types";
import { isEvidenceLinkable, type MediaRef } from "@/lib/contracts";
import { mapMediaToAsset } from "@/lib/scoreplay/map";
import { getSession } from "@/lib/server/auth";
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

/** ScorePlay's own rendition of a video, as nested under `video` in `GET /media/{id}` (top-level proxies may be empty). */
const NestedVideoShape = z.object({ video: z.object({ proxy_medium: z.string().nullish(), proxy_large: z.string().nullish() }).loose().nullish() }).loose();

async function resolve(ref: MediaRef, deps: PreviewDeps): Promise<Preview | undefined> {
  let nested: string | undefined;
  if (ref.scoreplayMediaId) {
    try {
      const media = await getMedia(deps.scoreplay, ref.scoreplayMediaId);
      const proxy = mapMediaToAsset(media, []).previewUrl;
      if (proxy?.startsWith("https://")) return { source: "SCOREPLAY_PROXY", url: proxy, hls: /\.m3u8(\?|$)/.test(proxy) };
      const video = NestedVideoShape.safeParse(media).data?.video;
      nested = [video?.proxy_medium, video?.proxy_large].find((u): u is string => !!u?.startsWith("https://"));
    } catch (err) {
      console.warn(`[media] ScorePlay preview lookup failed for ${ref.scoreplayMediaId}:`, err instanceof Error ? err.message : err);
    }
  }
  // A TwelveLabs stream is shown for a ScorePlay asset only through a linkable identity. An un-indexed clip plays
  // ScorePlay's own nested rendition instead (linked clips keep the TwelveLabs stream, as before).
  if (!isEvidenceLinkable(ref)) return nested ? { source: "SCOREPLAY_PROXY", url: nested, hls: false } : undefined;
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
 * HLS stream of a linkable ref — or undefined (also unless MEDIA_PREVIEW_ENABLED=true, and always under
 * DEMO_REPLAY: previews are never recorded). Never persisted: cached in memory for PREVIEW_TTL_MS.
 * Nothing is downloaded.
 */
export function previewFor(ref: MediaRef, opts: { club?: string; deps?: PreviewDeps } = {}): Promise<Preview | undefined> {
  if (!isMediaPreviewEnabled() || demoReplayEnabled()) return Promise.resolve(undefined);
  const deps = opts.deps ?? defaultDeps(opts.club);
  const now = (deps.now ?? Date.now)();
  const key = `${ref.twelvelabsIndexId ?? ""}|${ref.scoreplayMediaId ?? ""}|${isEvidenceLinkable(ref) ? ref.twelvelabsVideoId : ""}`;
  const hit = cache.get(key);
  if (hit && now - hit.at < PREVIEW_TTL_MS) return hit.preview;
  const preview = resolve(ref, deps);
  cache.set(key, { at: now, preview });
  return preview;
}

/**
 * Who may receive URLs derived from footage (streams, proxies, thumbnails):
 * DISABLED = MEDIA_PREVIEW_ENABLED is not "true" (default) — nobody; REVIEWER_ONLY = enabled, anonymous
 * caller — nobody; ALLOWED = enabled AND a reviewer session.
 */
export type MediaAccess = "DISABLED" | "REVIEWER_ONLY" | "ALLOWED";

export async function mediaAccess(req: Request): Promise<MediaAccess> {
  if (!isMediaPreviewEnabled()) return "DISABLED";
  return (await getSession(req)) ? "ALLOWED" : "REVIEWER_ONLY";
}

/** Fields that carry footage-derived URLs anywhere in an API payload (Asset, SearchHit, candidates, Preview). */
const MEDIA_URL_KEYS: ReadonlySet<string> = new Set(["thumbnailUrl", "previewUrl", "preview"]);

/** Deep copy of a JSON payload without any footage-derived URL field. Applied at every API boundary unless ALLOWED. */
export function withoutMediaUrls<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutMediaUrls) as T;
  if (value === null || typeof value !== "object") return value;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) if (!MEDIA_URL_KEYS.has(k)) out[k] = withoutMediaUrls(v);
  return out as T;
}

/** The payload as this caller may see it: unchanged only when ALLOWED. */
export const forMediaAccess = <T>(access: MediaAccess, value: T): T => (access === "ALLOWED" ? value : withoutMediaUrls(value));
