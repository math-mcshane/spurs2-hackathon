import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaRef, MediaResolver } from "@/lib/contracts";
import { TwelveLabsVideoIntelligence, memoryObservationStore } from "./client";

const sdk = vi.hoisted(() => ({
  searchCreate: vi.fn(),
  videoRetrieve: vi.fn(),
  analyze: vi.fn(),
}));

vi.mock("twelvelabs-js", () => ({
  TwelveLabs: class {
    search = { create: sdk.searchCreate };
    indexes = { videos: { retrieve: sdk.videoRetrieve } };
    analyze = sdk.analyze;
  },
}));
// Pass-through record/replay cache: no disk I/O in unit tests.
vi.mock("./cache", () => ({
  cacheKey: () => "k",
  recorded: async <T>(_req: unknown, live: () => Promise<T>) => ({ value: await live(), origin: "LIVE" as const }),
}));

const ref = (sp: string | null, tl: string | undefined, method: MediaRef["method"]): MediaRef => ({
  scoreplayMediaId: sp,
  twelvelabsVideoId: tl,
  method,
  candidates: [],
  checkedAt: "2026-10-22T00:00:00.000Z",
});

const resolver: MediaResolver = {
  forScoreplay: async (id) => ref(id, undefined, "UNMAPPED"),
  forTwelveLabs: async (id) =>
    ({ "tl-1": ref("130851361", "tl-1", "FILENAME_DURATION"), "tl-amb": ref(null, undefined, "AMBIGUOUS") })[id] ?? ref(null, undefined, "UNMAPPED"),
};

const client = () =>
  new TwelveLabsVideoIntelligence({
    config: { apiKey: "k", indexId: "idx", keyVariable: "TWELVELABS_API_KEY", indexVariable: "TWELVELABS_INDEX_ID" },
    resolver,
    observationStore: memoryObservationStore(),
  });

beforeEach(() => vi.clearAllMocks());

describe("TwelveLabsVideoIntelligence.search", () => {
  it("maps hits through the MediaResolver and drops unlinkable ones (reported)", async () => {
    sdk.searchCreate.mockResolvedValue({
      data: [
        { videoId: "tl-amb", start: 0, end: 5, rank: 1 },
        { videoId: "tl-1", start: 5827.63, end: 5833.23, rank: 2 },
        { videoId: "tl-foreign", start: 1, end: 2, rank: 3 },
      ],
    });
    const { hits, dropped } = await client().searchWithDiagnostics("Tottenham goal celebration");
    expect(hits).toEqual([
      { scoreplayMediaId: "130851361", twelvelabsVideoId: "tl-1", start: 5827.63, end: 5833.23, rank: 1, score: 2, origin: "LIVE", mapping: "FILENAME_DURATION" },
    ]);
    expect(dropped).toEqual([
      { twelvelabsVideoId: "tl-amb", method: "AMBIGUOUS" },
      { twelvelabsVideoId: "tl-foreign", method: "UNMAPPED" },
    ]);
  });
});

describe("TwelveLabsVideoIntelligence.observations", () => {
  it("refuses an unlinkable ref with a MEDIA_IDENTITY NOT_FOUND, without calling TwelveLabs", async () => {
    for (const r of [ref("1", undefined, "UNMAPPED"), ref("1", undefined, "AMBIGUOUS"), ref(null, "tl-1", "FILENAME_DURATION")]) {
      await expect(client().observations(r)).rejects.toMatchObject({ code: "NOT_FOUND", message: expect.stringMatching(/^MEDIA_IDENTITY: /) });
    }
    expect(sdk.videoRetrieve).not.toHaveBeenCalled();
    expect(sdk.analyze).not.toHaveBeenCalled();
  });

  it("analyzes ref.twelvelabsVideoId directly and serves the stored result afterwards", async () => {
    sdk.videoRetrieve.mockResolvedValue({ id: "tl-1", assetId: "asset-1" });
    sdk.analyze.mockResolvedValue({
      data: JSON.stringify({
        observations: [{ category: "person", entity: "Father and son", start_time: 0, end_time: 5, description: "fans", confidence: 0.8 }],
        rubric: { player_focus: "no_players" },
        summary: "Fans in the away end.",
      }),
      finishReason: "stop",
    });
    const c = client();
    const first = await c.observations(ref("130851417", "tl-1", "FILENAME_DURATION"));
    expect(sdk.videoRetrieve).toHaveBeenCalledWith("idx", "tl-1");
    expect(sdk.analyze).toHaveBeenCalledWith(expect.objectContaining({ video: { type: "asset_id", assetId: "asset-1" } }));
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((e) => e.scoreplayMediaId === "130851417" && e.origin === "LIVE")).toBe(true);

    const again = await c.observations(ref("130851417", "tl-1", "FILENAME_DURATION"));
    expect(sdk.analyze).toHaveBeenCalledTimes(1);
    expect(again.every((e) => e.origin === "CACHED")).toBe(true);
  });
});
