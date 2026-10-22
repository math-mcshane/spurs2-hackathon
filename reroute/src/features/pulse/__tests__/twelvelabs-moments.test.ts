import { describe, expect, it, vi } from "vitest";
import {
  classifyTwelveLabsError,
  loadCatalog,
  readTwelveLabsConfig,
  searchMoments,
  type AssetPage,
  type TwelveLabsSdk,
} from "../server/twelvelabs-moments";

/** Shape of twelvelabs-js `TwelvelabsApiError`. */
const apiError = (statusCode: number, code = "", message = "error") => Object.assign(new Error(message), { statusCode, body: { code, message } });

function pages(items: unknown[][]): AssetPage {
  const at = (i: number): AssetPage => ({ data: items[i], hasNextPage: () => i < items.length - 1, getNextPage: async () => at(i + 1) });
  return at(0);
}

function fakeSdk(over: Partial<{ index: TwelveLabsSdk["indexes"]["retrieve"]; assets: unknown[][]; create: TwelveLabsSdk["search"]["create"]; retrieve: TwelveLabsSdk["search"]["retrieve"] }> = {}): TwelveLabsSdk {
  return {
    indexes: {
      retrieve: over.index ?? (async () => ({ indexName: "premiere-league", videoCount: 2, models: [{ modelName: "marengo3.0", modelOptions: ["visual", "audio"] }] })),
      indexedAssets: { list: vi.fn(async () => pages(over.assets ?? [[]])) },
      videos: { retrieve: async () => ({}) },
    },
    search: {
      create: over.create ?? (async () => ({ data: [] })),
      retrieve: over.retrieve ?? (async () => ({ data: [] })),
    },
  };
}

describe("TwelveLabs configuration", () => {
  it("reports a missing key or index id", () => {
    expect(() => readTwelveLabsConfig({})).toThrow(expect.objectContaining({ code: "MISSING_API_KEY" }));
    expect(() => readTwelveLabsConfig({ TWELVELABS_API_KEY: "k" })).toThrow(expect.objectContaining({ code: "MISSING_INDEX_ID" }));
  });

  it("prefers the canonical key and accepts the legacy alias", () => {
    expect(readTwelveLabsConfig({ TWELVELABS_API_KEY: "a", TWELVE_LABS_API_KEY: "b", TWELVELABS_INDEX_ID: "i" })).toEqual({
      apiKey: "a",
      indexId: "i",
      keyVariable: "TWELVELABS_API_KEY",
    });
    expect(readTwelveLabsConfig({ TWELVE_LABS_API_KEY: "b", TWELVELABS_INDEX_ID: "i" }).keyVariable).toBe("TWELVE_LABS_API_KEY");
  });
});

describe("TwelveLabs error classification", () => {
  it.each([
    [apiError(401, "api_key_invalid"), "index", "INVALID_API_KEY"],
    [apiError(404, "resource_not_exists"), "index", "INDEX_NOT_ACCESSIBLE"],
    [apiError(403), "index", "INDEX_NOT_ACCESSIBLE"],
    [apiError(429), "search", "RATE_LIMITED"],
    [apiError(400, "search_option_not_supported"), "search", "UNSUPPORTED_SEARCH_OPTION"],
    [apiError(500), "search", "UPSTREAM_UNAVAILABLE"],
    [new TypeError("fetch failed"), "search", "UPSTREAM_UNAVAILABLE"],
  ] as const)("%o during %s → %s", (err, during, code) => {
    expect(classifyTwelveLabsError(err, during).code).toBe(code);
  });

  it("never leaks the upstream message body into the classified error", () => {
    expect(classifyTwelveLabsError(apiError(401, "api_key_invalid", "key tlk_secret is invalid"), "index").message).not.toContain("tlk_secret");
  });
});

describe("TwelveLabs index catalog", () => {
  it("classifies an empty or inaccessible index", async () => {
    await expect(loadCatalog(fakeSdk({ index: async () => ({ videoCount: 0 }) }), "idx-empty")).rejects.toMatchObject({ code: "EMPTY_INDEX" });
    await expect(loadCatalog(fakeSdk({ index: async () => Promise.reject(apiError(404, "resource_not_exists")) }), "idx-404")).rejects.toMatchObject({
      code: "INDEX_NOT_ACCESSIBLE",
    });
  });

  it("walks every page and reads the custom id from raw user_metadata", async () => {
    const asset = (id: string, filename: string, scoreplayId: string) => ({
      id,
      status: "ready",
      systemMetadata: { filename, duration: 30.2 },
      user_metadata: { scoreplay_id: scoreplayId },
    });
    const sdk = fakeSdk({ assets: [[asset("v1", "a.mp4", "100")], [asset("v2", "b.mp4", "200")]] });
    const c = await loadCatalog(sdk, "idx-pages");
    expect(c.entries).toEqual([
      { videoId: "v1", filename: "a.mp4", durationSec: 30.2, status: "ready", customId: "100" },
      { videoId: "v2", filename: "b.mp4", durationSec: 30.2, status: "ready", customId: "200" },
    ]);
    expect(c.searchOptions).toEqual(["visual", "audio"]);
  });
});

describe("TwelveLabs moment search", () => {
  it("restricts to given videos, follows nextPageToken and keeps exact timestamps", async () => {
    const create = vi.fn(async () => ({
      data: [{ videoId: "v1", start: 903.7666, end: 912.6331, rank: 1, userMetadata: { scoreplay_id: "130850832" } }],
      pageInfo: { nextPageToken: "t-1" },
    }));
    const retrieve = vi.fn(async () => ({ data: [{ videoId: "v2", start: 0, end: 7.87, rank: 2 }], pageInfo: {} }));
    const moments = await searchMoments(fakeSdk({ create, retrieve }), "idx", "defender block", { videoIds: ["v1", "v2"], limit: 5 });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ indexId: "idx", queryText: "defender block", groupBy: "clip", includeUserMetadata: true, filter: JSON.stringify({ id: ["v1", "v2"] }) }),
    );
    expect(retrieve).toHaveBeenCalledWith("t-1", { includeUserMetadata: true });
    expect(moments).toEqual([
      { videoId: "v1", start: 903.7666, end: 912.6331, rank: 1, thumbnailUrl: undefined, customId: "130850832", query: "defender block" },
      { videoId: "v2", start: 0, end: 7.87, rank: 2, thumbnailUrl: undefined, customId: undefined, query: "defender block" },
    ]);
  });

  it("stops paging at the limit and classifies search failures", async () => {
    const retrieve = vi.fn();
    const create = vi.fn(async () => ({ data: [{ videoId: "v1", start: 1, end: 2, rank: 1 }, { videoId: "v1", start: 3, end: 4, rank: 2 }], pageInfo: { nextPageToken: "t" } }));
    expect(await searchMoments(fakeSdk({ create, retrieve }), "idx", "q", { limit: 2 })).toHaveLength(2);
    expect(retrieve).not.toHaveBeenCalled();
    await expect(searchMoments(fakeSdk({ create: async () => Promise.reject(apiError(429)) }), "idx", "q")).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });
});
