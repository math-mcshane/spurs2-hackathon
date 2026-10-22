/**
 * Demo contingency (server-only): REAL upstream responses recorded by `scripts/record-demo-cache.ts` into
 * `demo-cache/<source>/<key>.json` (committed; JSON metadata only — EVERY URL (media, thumbnails,
 * transcripts, signed or not) and token-like values are removed before writing; no media, no previews).
 *
 * - `DEMO_REPLAY=true`: every read is answered from the recording (origin CACHED); a missing recording is
 *   an error — nothing is ever synthesized.
 * - otherwise: live; when the upstream is unavailable (network error, HTTP 429, 5xx) and a recording of the
 *   same request exists, that recording is served (CACHED) instead.
 * - `DEMO_RECORD=true` (set by the recorder only): successful live reads are written to the recording.
 * Every answer is reported to lib/media/provenance so the run can say LIVE / CACHED / MIXED.
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { reportOrigin, type RunProvenance } from "./provenance";

export type ReplaySource = "twelvelabs" | "scoreplay";
export type Replayed<T> = { value: T; origin: "LIVE" | "CACHED"; recordedAt?: string };
const RecordingSchema = z.object({ recordedAt: z.string(), source: z.enum(["twelvelabs", "scoreplay"]), request: z.unknown(), value: z.unknown() });
type Recording = z.infer<typeof RecordingSchema>;

/** The provenance of one replayable answer (for caches that re-report it on every reuse). */
export function provenanceOf(r: Replayed<unknown>): RunProvenance {
  return r.origin === "CACHED" && r.recordedAt ? { origin: "CACHED", recordedAt: r.recordedAt } : { origin: "LIVE" };
}

/** A recording was required (DEMO_REPLAY=true) but none exists for the request. */
export class ReplayMissError extends Error {
  constructor(
    readonly source: ReplaySource,
    readonly key: string,
  ) {
    super(`DEMO_REPLAY=true but no ${source} recording exists for this request (${key})`);
    this.name = "ReplayMissError";
  }
}

export const demoReplayEnabled = (): boolean => process.env.DEMO_REPLAY === "true";

/** `DEMO_CACHE_DIR` override (tests), else `<app>/demo-cache`. */
export const demoCacheDir = (): string => process.env.DEMO_CACHE_DIR?.trim() || path.join(process.cwd(), "demo-cache");

export function requestKey(request: unknown): string {
  return createHash("sha256").update(JSON.stringify(request)).digest("hex").slice(0, 32);
}

/** HTTP status (or none) of an upstream failure: `status` / `statusCode` on the error or its cause. */
function statusOf(err: unknown): number | undefined {
  let e: unknown = err;
  for (let depth = 0; e && typeof e === "object" && depth < 3; depth++) {
    const s = "statusCode" in e ? e.statusCode : "status" in e ? e.status : undefined;
    if (typeof s === "number") return s;
    e = "cause" in e ? e.cause : undefined;
  }
  return undefined;
}

/** Upstream unavailable: no HTTP response (network/DNS/timeout), HTTP 429, or HTTP 5xx. */
export function isUpstreamUnavailable(err: unknown): boolean {
  const status = statusOf(err);
  if (status !== undefined) return status === 429 || status >= 500;
  if (!(err instanceof Error)) return false;
  if (err.name === "TimeoutError" || err.name === "AbortError" || err.name === "TwelvelabsApiTimeoutError") return true;
  const text = `${err.message} ${String(err.cause ?? "")}`;
  return /fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|network error|socket hang up/i.test(text);
}

/** Token-like keys, and storage locators (S3 bucket/key) that point at protected footage. */
const SECRET_KEY = /token|signature|secret|password|api[-_]?key|credential|authorization|^aws_|bucket/i;
const SECRET_VALUE = /\b(tlk_[A-Za-z0-9]|sb_(secret|publishable)_|eyJ[A-Za-z0-9_-]{10,}\.)/;
/** Any URL anywhere in a string (footage links are protected even without a signature). */
const URL_VALUE = /[a-z][a-z0-9+.-]*:\/\/|\bwww\.[a-z0-9-]+\./i;
/** Personal data: uploader e-mail addresses. */
const EMAIL_VALUE = /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i;
const DROP = Symbol("drop");

/** Every URL-bearing, e-mail and token-like string is dropped (never rewritten); token-like/storage keys are dropped. */
function clean(value: unknown): unknown {
  if (typeof value === "string") return SECRET_VALUE.test(value) || URL_VALUE.test(value) || EMAIL_VALUE.test(value) ? DROP : value;
  if (Array.isArray(value)) return value.map(clean).filter((v) => v !== DROP);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      const c = clean(v);
      if (c !== DROP && c !== undefined) out[k] = c;
    }
    return out;
  }
  return value;
}

/** JSON-safe copy with every URL and token-like key/value removed (what is written to demo-cache). */
export function redact<T>(value: T): T {
  const c = clean(JSON.parse(JSON.stringify(value ?? null)));
  return (c === DROP ? null : c) as T;
}

const memo = new Map<string, Promise<Recording | undefined>>();

function fileOf(source: ReplaySource, key: string): string {
  return path.join(demoCacheDir(), source, `${key}.json`);
}

function readRecording(source: ReplaySource, key: string): Promise<Recording | undefined> {
  const file = fileOf(source, key);
  let hit = memo.get(file);
  if (!hit) {
    hit = readFile(file, "utf8")
      .then((text) => {
        const r = RecordingSchema.safeParse(JSON.parse(text));
        return r.success ? r.data : undefined;
      })
      .catch(() => undefined);
    memo.set(file, hit);
  }
  return hit;
}

async function writeRecording(source: ReplaySource, key: string, request: unknown, value: unknown): Promise<void> {
  const file = fileOf(source, key);
  const body: Recording = { recordedAt: new Date().toISOString(), source, request: redact(request), value: redact(value) };
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(body, null, 2)}\n`);
  memo.delete(file);
}

/** Drop memoized recordings (tests switch `DEMO_CACHE_DIR`). */
export function clearReplayMemo(): void {
  memo.clear();
}

/**
 * One upstream read with demo replay. `request` must identify the read completely and contain no secret
 * (it is hashed into the key and stored redacted). The value must be JSON-serializable; when replayed it is
 * the REDACTED recording, so callers must tolerate missing URL fields.
 */
export async function replayable<T>(source: ReplaySource, request: unknown, live: () => Promise<T>): Promise<Replayed<T>> {
  const key = requestKey(request);
  const cached = async (): Promise<Replayed<T> | undefined> => {
    const r = await readRecording(source, key);
    if (!r) return undefined;
    reportOrigin({ origin: "CACHED", recordedAt: r.recordedAt });
    return { value: r.value as T, origin: "CACHED", recordedAt: r.recordedAt };
  };
  if (demoReplayEnabled()) {
    const hit = await cached();
    if (!hit) throw new ReplayMissError(source, key);
    return hit;
  }
  try {
    const value = await live();
    if (process.env.DEMO_RECORD === "true") await writeRecording(source, key, request, value);
    reportOrigin({ origin: "LIVE" });
    return { value, origin: "LIVE" };
  } catch (err) {
    if (isUpstreamUnavailable(err)) {
      const hit = await cached();
      if (hit) {
        console.warn(`[replay] ${source} unavailable (${statusOf(err) ?? "network"}); serving recording ${key} from ${hit.recordedAt}`);
        return hit;
      }
    }
    throw err;
  }
}
