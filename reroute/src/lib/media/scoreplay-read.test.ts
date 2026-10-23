import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getMedia, type ScorePlayHttp } from "@/features/pulse/server/scoreplay-discovery";
import { ScorePlayHttpClient } from "@/lib/scoreplay/client";
import { clearReplayMemo } from "./replay";
import { MAX_RETRY_WAIT_MS, ScorePlayHttpError, readScorePlayJson, retryAfterMs } from "./scoreplay-read";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "scoreplay-read-test-"));
  vi.stubEnv("DEMO_CACHE_DIR", dir);
  vi.stubEnv("DEMO_REPLAY", "");
  vi.stubEnv("DEMO_RECORD", "");
  clearReplayMemo();
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  clearReplayMemo();
  await rm(dir, { recursive: true, force: true });
});

const READ = { method: "GET" as const, path: "/media/130851417" };
const json = (v: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", ...headers } });
const limited = (retryAfter?: string) => json({ message: "rate limit for key sp_secret_123" }, 429, retryAfter === undefined ? {} : { "Retry-After": retryAfter });

describe("ScorePlay 429", () => {
  it("honours Retry-After with exactly one retry", async () => {
    const send = vi.fn().mockResolvedValueOnce(limited("0")).mockResolvedValueOnce(json({ ID: 130851417 }));
    await expect(readScorePlayJson(READ, send)).resolves.toEqual({ value: { ID: 130851417 }, origin: "LIVE" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("gives up after the one retry with a status-only error (no upstream body)", async () => {
    const send = vi.fn(async () => limited("0"));
    const err = await readScorePlayJson(READ, send).catch((e: unknown) => e);
    expect(send).toHaveBeenCalledTimes(2);
    expect(err).toBeInstanceOf(ScorePlayHttpError);
    expect(err).toMatchObject({ statusCode: 429, message: "ScorePlay GET /media/130851417 → HTTP 429" });
    expect(err).not.toMatchObject({ message: expect.stringContaining("sp_secret") });
  });

  it("does not wait longer than the bound: a long Retry-After is not retried", async () => {
    const send = vi.fn(async () => limited(String(MAX_RETRY_WAIT_MS / 1000 + 115)));
    await expect(readScorePlayJson(READ, send)).rejects.toMatchObject({ statusCode: 429, retryAfterSec: 120 });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("falls back to the recording when still rate-limited", async () => {
    vi.stubEnv("DEMO_RECORD", "true");
    await readScorePlayJson(READ, async () => json({ ID: 130851417, name: "Fans clap Man United A 9x16.mp4" }));
    vi.stubEnv("DEMO_RECORD", "");
    clearReplayMemo();
    const send = vi.fn(async () => limited("0"));
    await expect(readScorePlayJson(READ, send)).resolves.toMatchObject({ origin: "CACHED", value: { name: "Fans clap Man United A 9x16.mp4" } });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("parses Retry-After seconds and HTTP dates", () => {
    expect(retryAfterMs("3")).toBe(3000);
    expect(retryAfterMs(new Date(10_000).toUTCString(), 4_000)).toBe(6000);
    expect(retryAfterMs(null)).toBeUndefined();
    expect(retryAfterMs("soon")).toBeUndefined();
  });
});

describe("user-facing errors on both ScorePlay read paths", () => {
  it("PULSE discovery: RATE_LIMITED with a clear message, never the upstream text", async () => {
    const http: ScorePlayHttp = { fetch: vi.fn(async () => limited("0")) as unknown as typeof fetch, apiKey: "k", baseUrl: "https://sp.test/v1" };
    const err = await getMedia(http, "130851417").catch((e: unknown) => e);
    expect(err).toMatchObject({ code: "RATE_LIMITED", message: "ScorePlay is rate-limiting requests (GET /media/130851417); try again shortly" });
    expect(http.fetch).toHaveBeenCalledTimes(2);
  });

  it("PULSE discovery: 503 without a recording is UPSTREAM_UNAVAILABLE, with a recording it is served", async () => {
    const down = vi.fn(async () => json({ error: "maintenance" }, 503));
    const http: ScorePlayHttp = { fetch: down as unknown as typeof fetch, apiKey: "k", baseUrl: "https://sp.test/v1" };
    await expect(getMedia(http, "130851417")).rejects.toMatchObject({ code: "UPSTREAM_UNAVAILABLE", message: "ScorePlay is temporarily unavailable (GET /media/130851417 → HTTP 503)" });
    vi.stubEnv("DEMO_RECORD", "true");
    await getMedia({ ...http, fetch: (async () => json({ ID: 130851417, type: "video", name: "a.mp4" })) as unknown as typeof fetch }, "130851417");
    vi.stubEnv("DEMO_RECORD", "");
    clearReplayMemo();
    await expect(getMedia(http, "130851417")).resolves.toMatchObject({ ID: 130851417, name: "a.mp4" });
  });

  it("REROUTE rights reads (lib/scoreplay getAsset): RATE_LIMITED + Retry-After header, no upstream body", async () => {
    vi.stubEnv("SCOREPLAY_API_KEY", "k");
    vi.stubEnv("SCOREPLAY_API_BASE_URL", "https://sp.test/v1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: URL | string) => (new URL(String(input)).pathname.startsWith("/v1/media/") ? limited("1") : json({ items: [] }))),
    );
    const err = await new ScorePlayHttpClient().getAsset("130851417").catch((e: unknown) => e);
    expect(err).toMatchObject({
      code: "RATE_LIMITED",
      headers: { "Retry-After": "1" },
      message: "ScorePlay is rate-limiting requests (GET /media/130851417); try again in about 1 s",
    });
  });
});
