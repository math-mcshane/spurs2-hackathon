import { describe, expect, it, vi } from "vitest";
import { detectOpportunities } from "../detect-opportunities";
import { buildView } from "../rank-opportunities";
import { linkToIndex, lookupMedia, type MediaDeps } from "../server/media-lookup";
import type { DiscoveredVideo, ScorePlayHttp } from "../server/scoreplay-discovery";
import { TwelveLabsError, type AssetPage, type TwelveLabsSdk } from "../server/twelvelabs-moments";
import { SPONSOR_BRIEFS, fixtureSignals } from "../signal-adapter";

const NOW = new Date("2026-10-17T22:00:00Z");
const opp = (id: string) =>
  detectOpportunities(fixtureSignals(), SPONSOR_BRIEFS, { now: NOW, replayClock: NOW }, NOW.toISOString()).find((o) => o.id === id)!;

/** ScorePlay: Tottenham team tag → two videos in *this* workspace (ids differ from the index's). */
const scoreplay = (status = 200): ScorePlayHttp => ({
  apiKey: "k",
  fetch: (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const json = url.pathname.endsWith("/tag/search")
      ? { tags: [{ ID: 10797055, name: "tottenham hotspur fc" }] }
      : body.any_tag_options
        ? {
            media: [
              { ID: 130851361, name: "Full Match.mp4", type: "video", media_duration: 6334.8e9 },
              { ID: 130851357, name: "9x16_DEF_ACTIONS_VS_MNU.mp4", type: "video", media_duration: 120.6e9 },
            ],
            count: 2,
          }
        : { media: [], count: 0 };
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

const video = (id: string, title: string, durationSec: number): DiscoveredVideo => ({
  asset: { id, title, kind: "video", durationSec, tags: [], facts: {}, metadata: {}, origin: "LIVE" },
  discoveredBy: "TEAM_TAG",
});

describe("ScorePlay ↔ TwelveLabs mapping", () => {
  it("prefers the index custom id, else one exact filename with the same duration; never guesses", () => {
    const catalog = [
      { videoId: "tl-a", filename: "a.mp4", durationSec: 30, customId: "100" },
      { videoId: "tl-b", filename: "b.mp4", durationSec: 18.5, customId: "999" },
      { videoId: "tl-c1", filename: "dup.mp4", durationSec: 10, customId: "x" },
      { videoId: "tl-c2", filename: "dup.mp4", durationSec: 10, customId: "y" },
      { videoId: "tl-d", filename: "d.mp4", durationSec: 60, customId: "z" },
    ];
    const { links, ambiguous } = linkToIndex(
      [video("100", "renamed.mp4", 30), video("200", "b.mp4", 18), video("300", "dup.mp4", 10), video("400", "d.mp4", 45), video("500", "none.mp4", 5)],
      catalog,
    );
    expect(links.map((l) => [l.video.asset.id, l.entry.videoId, l.via])).toEqual([
      ["100", "tl-a", "CUSTOM_ID"],
      ["200", "tl-b", "FILENAME_DURATION"],
    ]);
    expect(ambiguous).toEqual(["300"]);
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
      mapping: { via: "FILENAME_DURATION", indexedScoreplayId: "130850832", filename: "Full Match.mp4" },
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
