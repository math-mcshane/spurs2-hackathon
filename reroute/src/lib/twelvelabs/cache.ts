/**
 * Record/replay cache for REAL TwelveLabs responses. Every live response is written to
 * `.cache/twelvelabs/<hash>.json`. Replay is used only when TWELVELABS_REPLAY=true or a live call
 * fails with a network error. Nothing is ever synthesized: a cache miss rethrows.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DataOrigin } from "@/lib/contracts";
import { AppError } from "@/lib/errors";

const CACHE_DIR = path.join(process.cwd(), ".cache", "twelvelabs");

export function cacheKey(parts: unknown): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 32);
}

export function replayEnabled(): boolean {
  return process.env.TWELVELABS_REPLAY === "true";
}

/** Network-level failure (no HTTP response): fetch failure, DNS, refused, reset, timeout. */
export function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "TwelvelabsApiTimeoutError" || err.name === "AbortError") return true;
  if (err.name === "TwelvelabsApiError" && "statusCode" in err && err.statusCode !== undefined) return false;
  const text = `${err.message} ${String(err.cause ?? "")}`;
  return /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network|socket/i.test(text);
}

async function readCached<T>(key: string): Promise<T | undefined> {
  try {
    const file: unknown = JSON.parse(await readFile(path.join(CACHE_DIR, `${key}.json`), "utf8"));
    // Files are written only by writeCached with the value produced by the same request key.
    return file && typeof file === "object" && "value" in file ? (file.value as T) : undefined;
  } catch {
    return undefined;
  }
}

async function writeCached(key: string, request: unknown, value: unknown): Promise<void> {
  await mkdir(CACHE_DIR, { recursive: true });
  const body = { recordedAt: new Date().toISOString(), request, value };
  await writeFile(path.join(CACHE_DIR, `${key}.json`), JSON.stringify(body, null, 2));
}

/**
 * Run `live`, record its JSON-serializable result, and return it with origin LIVE. In replay mode
 * or on network failure, return the recorded real result with origin CACHED.
 */
export async function recorded<T>(request: unknown, live: () => Promise<T>): Promise<{ value: T; origin: DataOrigin }> {
  const key = cacheKey(request);
  if (replayEnabled()) {
    const value = await readCached<T>(key);
    if (value === undefined) {
      throw new AppError("UPSTREAM", `TWELVELABS_REPLAY=true but no recorded TwelveLabs response for ${key}`);
    }
    return { value, origin: "CACHED" };
  }
  try {
    const value = await live();
    await writeCached(key, request, value).catch((e) => console.warn("[twelvelabs] cache write failed", e));
    return { value, origin: "LIVE" };
  } catch (err) {
    if (isNetworkError(err)) {
      const value = await readCached<T>(key);
      if (value !== undefined) {
        console.warn(`[twelvelabs] network error, serving recorded response ${key}`);
        return { value, origin: "CACHED" };
      }
    }
    throw err;
  }
}
