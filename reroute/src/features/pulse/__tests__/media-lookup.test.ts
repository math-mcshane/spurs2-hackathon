import { describe, expect, it, vi } from "vitest";
import { detectOpportunities } from "../detect-opportunities";
import { buildView } from "../rank-opportunities";
import { lookupMedia, type MediaDeps } from "../server/media-lookup";
import type { ScorePlayHttp } from "../server/scoreplay-discovery";
import { TwelveLabsError, type AssetPage, type TwelveLabsSdk } from "../server/twelvelabs-moments";
import { SPONSOR_BRIEFS, fixtureSignals } from "../signal-adapter";

const NOW = new Date("2026-10-17T22:00:00Z");
const opp = (id: string) =>
  detectOpportunities(fixtureSignals(), SPONSOR_BRIEFS, { now: NOW, replayClock: NOW }, NOW.toISOString()).find((o) => o.id === id)!;

/** ScorePlay: Tottenham team tag → two videos in *this* workspace (ids differ from the index's). */
const LIBRARY = [
  { ID: 130851361, name: "Full Match.mp4", type: "video", media_duration: 6334.8e9 },
  { ID: 130851357, name: "9x16_DEF_ACTIONS_VS_MNU.mp4", type: "video", media_duration: 120.6e9 },
];
const scoreplay = (status = 200): ScorePlayHttp => ({
  apiKey: "k",
  fetch: (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const byId = /\/media\/(\d+)$/.exec(url.pathname);
    const json = url.pathname.endsWith("/tag/search")
      ? { tags: [{ ID: 10797055, name: "tottenham hotspur fc" }] }
      : byId
        ? LIBRARY.find((m) => String(m.ID) === byId[1])
        : // Like the real API, search truncates durations to whole seconds; GET /media/{id} is exact.
          { media: LIBRARY.map((m) => ({ ...m, media_duration: Math.floor(m.media_duration / 1e9) * 1e9 })), count: LIBRARY.length };
    return new Response(JSON.stringify(json), { status });
  }) as unknown as typeof fetch,
});

const indexed = (id: string, filename: string, duration: number, scoreplayId: string) => ({
  id,
  status: "ready",
  systemMetadata: { filename, duration },
  user_metadata: { scoreplay_id: scoreplayId },
});

let indexSeq = 0;
function twelvelabs(search: TwelveLabsSdk["search"]["create"], assets = [indexed("tl-full", "Full Match.mp4", 6335.1, "130850832")]): MediaDeps["twelvelabs"] {
  const page: AssetPage = { data: assets, hasNextPage: () => false, getNextPage: async () => page };
  const sdk: TwelveLabsSdk = {
    indexes: {
      retrieve: async () => ({ indexName: "premiere-league", videoCount: assets.length, models: [{ modelName: "marengo3.0", modelOptions: ["visual"] }] }),
      indexedAssets: { list: async () => page },
      videos: { retrieve: async () => ({}) },
    },
    search: { create: search, retrieve: async () => ({ data: [] }) },
  };
  const indexId = `idx-${++indexSeq}`; // the catalog is cached per index id
  return () => ({ sdk, indexId });
}
describe("media identity", () => {
  it("reports ambiguous and unindexed ScorePlay videos as a MAPPING_FAILED attempt and never links them", async () => {
    const create = vi.fn(async () => ({ data: [] }));
    const r = await lookupMedia(opp("opp-tottenham-defensive-wall"), {
      scoreplay: scoreplay(),
      twelvelabs: twelvelabs(create, [indexed("tl-a", "Full Match.mp4", 6335.1, "1"), indexed("tl-b", "Full Match.mp4", 6334.9, "2")]),
    });
    expect(create).not.toHaveBeenCalled();
    expect(r.intelligence).toMatchObject({ status: "NOT_INDEXED", code: "MAPPING_FAILED" });
    const attempt = r.attempts.find((a) => a.code === "MAPPING_FAILED")!;
    expect(attempt.detail).toMatch(/1 ambiguous .*130851361 ↔ tl-a\/tl-b/);
    expect(attempt.detail).toMatch(/1 not in index premiere-league \(130851357\)/);
    expect(r.candidates.every((c) => c.foundBy === "SCOREPLAY_METADATA_FALLBACK" && !c.twelveLabsVideoId)).toBe(true);
  });
});

describe("media pipeline", () => {
  it("finds moments inside ScorePlay-discovered videos and maps them back with exact timestamps", async () => {
    const create = vi.fn(async () => ({ data: [{ videoId: "tl-full", start: 903.7666, end: 912.6331, rank: 1 }] }));
    const r = await lookupMedia(opp("opp-tottenham-defensive-wall"), { scoreplay: scoreplay(), twelvelabs: twelvelabs(create) });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ filter: JSON.stringify({ id: ["tl-full"] }), searchOptions: ["visual"] }));
    expect(r.intelligence.status).toBe("MOMENTS_FOUND");
    expect(r.candidates[0]).toMatchObject({
      scoreplayAssetId: "130851361",
      twelveLabsVideoId: "tl-full",
      startSeconds: 903.7666,
      endSeconds: 912.6331,
      rank: 1,
      foundBy: "TWELVELABS",
      mapping: { via: "FILENAME_DURATION", filename: "Full Match.mp4" },
    });
    // Remaining ScorePlay videos are still offered, clearly labeled as metadata matches.
    expect(r.candidates[1]).toMatchObject({ scoreplayAssetId: "130851357", foundBy: "SCOREPLAY_METADATA_FALLBACK" });
    expect(r.candidates[1].startSeconds).toBeUndefined();
  });

  it("labels the ScorePlay fallback and says why: not configured, not indexed, or no matching moment", async () => {
    const missing = await lookupMedia(opp("opp-tottenham-defensive-wall"), {
      scoreplay: scoreplay(),
      twelvelabs: () => {
        throw new TwelveLabsError("MISSING_INDEX_ID", "TWELVELABS_INDEX_ID is not set");
      },
    });
    expect(missing.intelligence).toMatchObject({ status: "UNAVAILABLE", code: "MISSING_INDEX_ID" });
    expect(missing.candidates.every((c) => c.foundBy === "SCOREPLAY_METADATA_FALLBACK")).toBe(true);

    const notIndexed = await lookupMedia(opp("opp-tottenham-defensive-wall"), {
      scoreplay: scoreplay(),
      twelvelabs: twelvelabs(vi.fn(), [indexed("tl-x", "other.mp4", 12, "1")]),
    });
    expect(notIndexed.intelligence.status).toBe("NOT_INDEXED");

    const none = await lookupMedia(opp("opp-tottenham-defensive-wall"), { scoreplay: scoreplay(), twelvelabs: twelvelabs(async () => ({ data: [] })) });
    expect(none.intelligence).toMatchObject({ status: "NO_MATCHING_MOMENT", code: "NO_SEARCH_RESULTS" });
    expect(none.candidates.length).toBeGreaterThan(0);
  });

  it("returns no candidates — never simulated ones — when ScorePlay is unreachable", async () => {
    const r = await lookupMedia(opp("opp-tottenham-defensive-wall"), { scoreplay: scoreplay(401), twelvelabs: twelvelabs(vi.fn()) });
    expect(r).toMatchObject({ status: "UNAVAILABLE", candidates: [] });
    expect(r.attempts[0]).toMatchObject({ service: "ScorePlay", outcome: "ERROR", code: "UNAUTHORIZED" });
  });

  it("a live TwelveLabs moment never implies a rights verdict", async () => {
    const o = opp("opp-tottenham-defensive-wall");
    const r = await lookupMedia(o, { scoreplay: scoreplay(), twelvelabs: twelvelabs(async () => ({ data: [{ videoId: "tl-full", start: 1, end: 9, rank: 1 }] })) });
    expect(buildView(o, r, undefined)).toMatchObject({ rightsState: "NOT_CHECKED", gate: "NEEDS_CLEARANCE" });
  });
});
