import { describe, expect, it, vi } from "vitest";
import { discoverVideos, resolveTags, searchMediaPages, ScorePlayDiscoveryError, type ScorePlayHttp } from "../server/scoreplay-discovery";

type Call = { method: string; path: string; query: URLSearchParams; body?: Record<string, unknown> };

const media = (id: number, name: string, type = "video", seconds = 14) => ({ ID: id, name, type, media_duration: seconds * 1e9 });

/** Fake ScorePlay API: records calls, answers via `route`. */
function fakeHttp(route: (c: Call) => { status?: number; json?: unknown } | Promise<never>): { http: ScorePlayHttp; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const call: Call = {
      method: init?.method ?? "GET",
      path: url.pathname.replace("/v1", ""),
      query: url.searchParams,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    const res = await route(call);
    return new Response(JSON.stringify(res.json ?? {}), { status: res.status ?? 200 });
  });
  return { http: { fetch: fetchFn as unknown as typeof fetch, apiKey: "test-key", baseUrl: "https://media.scoreplay.io/v1" }, calls };
}

describe("ScorePlay errors", () => {
  it("reports a missing key without calling the API", async () => {
    const { http, calls } = fakeHttp(() => ({ json: {} }));
    await expect(resolveTags({ ...http, apiKey: undefined }, ["Harper"])).rejects.toMatchObject({ code: "MISSING_API_KEY" });
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, "UNAUTHORIZED"],
    [403, "UNAUTHORIZED"],
    [429, "RATE_LIMITED"],
    [400, "BAD_REQUEST"],
    [503, "UPSTREAM_UNAVAILABLE"],
  ])("maps HTTP %i to %s", async (status, code) => {
    const { http } = fakeHttp(() => ({ status, json: { message: "x" } }));
    await expect(searchMediaPages(http, {})).rejects.toMatchObject({ code });
  });

  it("maps network failures and malformed bodies", async () => {
    const down: ScorePlayHttp = { fetch: (async () => Promise.reject(new TypeError("fetch failed"))) as unknown as typeof fetch, apiKey: "k" };
    await expect(searchMediaPages(down, {})).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE" });
    const { http } = fakeHttp(() => ({ json: { media: "nope" } }));
    const err = await searchMediaPages(http, {}).catch((e) => e);
    expect(err).toBeInstanceOf(ScorePlayDiscoveryError);
    expect(err.code).toBe("INVALID_RESPONSE");
  });

  it("authenticates with the documented header", async () => {
    const { http } = fakeHttp(() => ({ json: { media: [] } }));
    await searchMediaPages(http, {});
    const init = vi.mocked(http.fetch).mock.calls[0][1];
    expect(new Headers(init?.headers).get("X-ScorePlay-Api-Key")).toBe("test-key");
  });
});

describe("ScorePlay pagination", () => {
  it("follows page/per_page in the query string until a short page", async () => {
    const all = Array.from({ length: 122 }, (_, i) => media(1000 + i, `clip-${i}.mov`));
    const { http, calls } = fakeHttp((c) => {
      const page = Number(c.query.get("page"));
      const per = Number(c.query.get("per_page"));
      return { json: { media: all.slice((page - 1) * per, page * per), count: 122, total_pages: 3 } };
    });
    const res = await searchMediaPages(http, { media_type: "video" }, { perPage: 50, maxItems: 500 });
    expect(res).toMatchObject({ count: 122, pages: 3 });
    expect(new Set(res.media.map((m) => m.ID)).size).toBe(122);
    expect(calls.map((c) => c.query.get("page"))).toEqual(["1", "2", "3"]);
    expect(calls.every((c) => c.body && !("page" in c.body) && c.body.media_type === "video")).toBe(true);
  });

  it("stops at maxItems and at total_pages", async () => {
    const { http, calls } = fakeHttp(() => ({ json: { media: Array.from({ length: 10 }, (_, i) => media(i, `c${i}`)), count: 999, total_pages: 100 } }));
    expect((await searchMediaPages(http, {}, { perPage: 10, maxItems: 25 })).media).toHaveLength(25);
    expect(calls).toHaveLength(3);
    const last = fakeHttp(() => ({ json: { media: Array.from({ length: 10 }, (_, i) => media(i, `c${i}`)), count: 10, total_pages: 1 } }));
    await searchMediaPages(last.http, {}, { perPage: 10 });
    expect(last.calls).toHaveLength(1);
  });

  it("returns an empty page set for no matches", async () => {
    const { http } = fakeHttp(() => ({ json: { media: null, count: 0 } }));
    expect(await searchMediaPages(http, { name: "nothing" })).toMatchObject({ media: [], count: 0, pages: 1 });
  });
});

describe("ScorePlay discovery", () => {
  const library = (c: Call) => {
    if (c.path === "/tag/search") {
      const q = c.query.get("query");
      return {
        json:
          q === "Harper"
            ? { players: [{ ID: 736860, full_name: "Dylan Harper" }, { ID: 1, full_name: "Someone Else" }], tags: [] }
            : q === "Tottenham Hotspur"
              ? { tags: [{ ID: 10797055, name: "tottenham hotspur fc" }], players: [] }
              : { tags: [], players: [] },
      };
    }
    if (c.body?.name === "Harper") return { json: { media: [media(130907177, "Harper14PTRun.mp4", "video", 30), media(9, "Harper.jpg", "photo")], count: 2 } };
    if (c.body?.any_players) return { json: { media: [media(130907177, "Harper14PTRun.mp4", "video", 30), media(130934179, "X S1 DUNK!.mov")], count: 2 } };
    return { json: { media: [], count: 0 } };
  };

  it("resolves names to IDs, keeping only entries that contain the term", async () => {
    const { http, calls } = fakeHttp(library);
    const r = await resolveTags(http, ["Harper", "bench reaction"]);
    expect(r.players).toEqual([{ id: 736860, name: "Dylan Harper" }]);
    expect(r.unresolved).toEqual(["bench reaction"]);
    expect(calls[0].query.get("query")).toBe("Harper");
  });

  it("queries filename words and player IDs for videos only, de-duplicated, filename matches first", async () => {
    const { http, calls } = fakeHttp(library);
    const d = await discoverVideos(http, { terms: ["Harper"], filenameHints: ["Harper"] });
    const searches = calls.filter((c) => c.path === "/media/search").map((c) => c.body);
    expect(searches).toEqual([
      { name: "Harper", media_type: "video" },
      { any_players: [736860], media_type: "video" },
    ]);
    expect(d.videos.map((v) => [v.asset.id, v.discoveredBy])).toEqual([
      ["130907177", "FILENAME"],
      ["130934179", "PLAYER_TAG"],
    ]);
    expect(d.videos[0].asset).toMatchObject({ title: "Harper14PTRun.mp4", kind: "video", durationSec: 30 });
  });

  it("uses team tags as an OR filter and finds nothing when nothing resolves", async () => {
    const team = fakeHttp(library);
    await discoverVideos(team.http, { terms: ["Tottenham Hotspur"], filenameHints: [] });
    expect(team.calls.find((c) => c.path === "/media/search")?.body).toEqual({ any_tag_options: [10797055], media_type: "video" });
    const none = fakeHttp(library);
    const d = await discoverVideos(none.http, { terms: ["bench reaction after a dunk"], filenameHints: [] });
    expect(d.videos).toEqual([]);
    expect(none.calls.some((c) => c.path === "/media/search")).toBe(false);
  });
});
