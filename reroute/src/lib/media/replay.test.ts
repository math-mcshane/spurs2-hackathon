import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchMoments, type TwelveLabsSdk } from "@/features/pulse/server/twelvelabs-moments";
import { mergeProvenance, trackProvenance } from "./provenance";
import { ReplayMissError, clearReplayMemo, isUpstreamUnavailable, redact, replayable } from "./replay";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "replay-test-"));
  vi.stubEnv("DEMO_CACHE_DIR", dir);
  vi.stubEnv("DEMO_REPLAY", "");
  vi.stubEnv("DEMO_RECORD", "");
  clearReplayMemo();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  clearReplayMemo();
  await rm(dir, { recursive: true, force: true });
});

const REQUEST = { op: "search", indexId: "idx-test", query: "away end" };
const LIVE_VALUE = {
  hits: [{ videoId: "v1", start: 1.5, thumbnailUrl: "https://cdn.example.com/t.jpg?Expires=1&Signature=abc&Key-Pair-Id=K" }],
  poster: "https://cdn.example.com/poster.jpg",
  access_token: "secret-value",
  note: "uses key tlk_ABCDEF",
};

/** Records REQUEST as the recorder would (DEMO_RECORD=true, live read). */
async function record(value: unknown = LIVE_VALUE) {
  vi.stubEnv("DEMO_RECORD", "true");
  await replayable("twelvelabs", REQUEST, async () => value);
  vi.stubEnv("DEMO_RECORD", "");
  clearReplayMemo();
}

const unavailable = (statusCode: number) => Object.assign(new Error(`HTTP ${statusCode}`), { statusCode });

describe("demo recording", () => {
  it("writes JSON metadata only: every URL and token-like keys/values are removed", async () => {
    await record();
    const [file] = await readdir(path.join(dir, "twelvelabs"));
    const text = await readFile(path.join(dir, "twelvelabs", file), "utf8");
    expect(text).not.toMatch(/:\/\/|\?|Signature|token|tlk_|cdn\.example/);
    const r = JSON.parse(text);
    expect(r).toMatchObject({ source: "twelvelabs", recordedAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/), value: { hits: [{ videoId: "v1", start: 1.5 }] } });
    expect(r.value).not.toHaveProperty("poster");
    expect(r.value.hits[0]).not.toHaveProperty("thumbnailUrl");
    expect(redact({ list: ["https://x.test/a.mp4", "see www.example.com/x", "Fans clap Man United A 9x16.mp4"] })).toEqual({ list: ["Fans clap Man United A 9x16.mp4"] });
  });

  it("is not written during normal live use", async () => {
    await replayable("twelvelabs", REQUEST, async () => LIVE_VALUE);
    await expect(readdir(dir)).resolves.toEqual([]);
  });
});

describe("DEMO_REPLAY=true", () => {
  it("serves the recording labeled CACHED with recordedAt, never calls upstream, and the run says CACHED", async () => {
    await record();
    vi.stubEnv("DEMO_REPLAY", "true");
    const live = vi.fn(async () => LIVE_VALUE);
    const { value, provenance } = await trackProvenance(() => replayable("twelvelabs", REQUEST, live));
    expect(live).not.toHaveBeenCalled();
    expect(value).toMatchObject({ origin: "CACHED", recordedAt: expect.any(String), value: { hits: [{ videoId: "v1" }] } });
    expect(value.value).not.toHaveProperty("access_token");
    expect(provenance).toEqual({ origin: "CACHED", recordedAt: value.recordedAt });
  });

  it("never synthesizes: a missing recording is an error", async () => {
    vi.stubEnv("DEMO_REPLAY", "true");
    await expect(replayable("scoreplay", { path: "/media/1" }, async () => 1)).rejects.toBeInstanceOf(ReplayMissError);
  });

  it("labels replayed moments CACHED end to end (twelvelabs-moments)", async () => {
    const sdk = {
      search: { create: async () => ({ data: [{ videoId: "v1", start: 3, end: 8.4, rank: 1 }] }), retrieve: async () => ({ data: [] }) },
    } as unknown as TwelveLabsSdk; // searchMoments touches only `search`
    vi.stubEnv("DEMO_RECORD", "true");
    expect((await searchMoments(sdk, "idx-test", "fans clap")).map((m) => m.origin)).toEqual(["LIVE"]);
    vi.stubEnv("DEMO_RECORD", "");
    vi.stubEnv("DEMO_REPLAY", "true");
    clearReplayMemo();
    expect(await searchMoments(sdk, "idx-test", "fans clap")).toEqual([{ videoId: "v1", start: 3, end: 8.4, rank: 1, query: "fans clap", origin: "CACHED" }]);
  });
});

describe("automatic fallback (no flag)", () => {
  it("serves the recording when the upstream answers 503 (or 429, or no response)", async () => {
    await record();
    for (const err of [unavailable(503), unavailable(429), new TypeError("fetch failed")]) {
      const out = await replayable("twelvelabs", REQUEST, async () => Promise.reject(err));
      expect(out).toMatchObject({ origin: "CACHED", recordedAt: expect.any(String) });
    }
  });

  it("rethrows when nothing was recorded, and never masks other HTTP errors", async () => {
    await expect(replayable("twelvelabs", { other: true }, async () => Promise.reject(unavailable(503)))).rejects.toMatchObject({ statusCode: 503 });
    await record();
    await expect(replayable("twelvelabs", REQUEST, async () => Promise.reject(unavailable(400)))).rejects.toMatchObject({ statusCode: 400 });
    expect(isUpstreamUnavailable(unavailable(401))).toBe(false);
  });

  it("reports MIXED when a run combines live and recorded reads", async () => {
    await record();
    const { provenance } = await trackProvenance(async () => {
      await replayable("twelvelabs", { live: true }, async () => 1);
      await replayable("twelvelabs", REQUEST, async () => Promise.reject(unavailable(502)));
    });
    expect(provenance).toMatchObject({ origin: "MIXED", recordedAt: expect.any(String) });
    expect(mergeProvenance({ origin: "LIVE" }, { origin: "CACHED", recordedAt: "2026-10-22T00:00:00Z" })).toEqual({ origin: "MIXED", recordedAt: "2026-10-22T00:00:00Z" });
    expect(mergeProvenance(undefined, { origin: "LIVE" })).toEqual({ origin: "LIVE" });
    expect((await trackProvenance(async () => 1)).provenance).toBeUndefined();
  });
});
