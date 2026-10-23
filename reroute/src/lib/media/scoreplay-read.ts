/**
 * The one ScorePlay READ path shared by PULSE discovery and lib/scoreplay's client (server-only):
 * HTTP 429 honours `Retry-After` with ONE bounded retry; a still-unavailable upstream (network, 429, 5xx)
 * falls back to the demo recording when one exists (lib/media/replay); otherwise callers turn the
 * `ScorePlayHttpError` into a user-facing message that never carries the upstream body.
 */
import { setTimeout as sleep } from "node:timers/promises";
import { replayable, type Replayed } from "./replay";

/** Longest `Retry-After` we wait for inside a user request; longer → no retry (recording or error). */
export const MAX_RETRY_WAIT_MS = 5_000;
/** Wait when a 429 carries no usable `Retry-After`. */
const DEFAULT_RETRY_WAIT_MS = 1_000;

export type ScorePlayRead = { method: "GET" | "POST"; path: string; query?: Record<string, string | number | boolean | undefined>; body?: unknown };

/** Non-2xx ScorePlay response. `message` names only the operation and status. */
export class ScorePlayHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly operation: string,
    /** Seconds from `Retry-After` on a 429, when given. */
    readonly retryAfterSec?: number,
  ) {
    super(`ScorePlay ${operation} → HTTP ${statusCode}`);
    this.name = "ScorePlayHttpError";
  }
}

/** 2xx ScorePlay response whose body is not JSON. */
export class ScorePlayInvalidResponseError extends Error {
  constructor(readonly operation: string) {
    super(`ScorePlay ${operation}: non-JSON response`);
    this.name = "ScorePlayInvalidResponseError";
  }
}

/** `Retry-After` (delta-seconds or HTTP-date) in ms; undefined when absent or unparseable. */
export function retryAfterMs(header: string | null, now = Date.now()): number | undefined {
  const v = header?.trim();
  if (!v) return undefined;
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}

async function logFailure(operation: string, res: Response): Promise<void> {
  const body = await res.text().catch(() => "");
  console.warn(`[scoreplay] ${operation} → HTTP ${res.status}:`, body.slice(0, 200));
}

/**
 * Parsed JSON of one ScorePlay read (unvalidated — callers apply their schema). `send` performs the HTTP
 * call (auth, timeout); its own errors (network, timeout) propagate unchanged unless a recording answers.
 */
export function readScorePlayJson(request: ScorePlayRead, send: () => Promise<Response>): Promise<Replayed<unknown>> {
  const operation = `${request.method} ${request.path}`;
  const key = { method: request.method, path: request.path, query: request.query ?? {}, body: request.body ?? null };
  return replayable("scoreplay", key, async () => {
    let res = await send();
    if (res.status === 429) {
      const wait = retryAfterMs(res.headers.get("retry-after")) ?? DEFAULT_RETRY_WAIT_MS;
      await logFailure(operation, res);
      if (wait > MAX_RETRY_WAIT_MS) throw new ScorePlayHttpError(429, operation, Math.ceil(wait / 1000));
      await sleep(wait);
      res = await send();
    }
    if (!res.ok) {
      const after = res.status === 429 ? retryAfterMs(res.headers.get("retry-after")) : undefined;
      await logFailure(operation, res);
      throw new ScorePlayHttpError(res.status, operation, after === undefined ? undefined : Math.ceil(after / 1000));
    }
    const text = await res.text();
    try {
      return text ? (JSON.parse(text) as unknown) : null;
    } catch {
      throw new ScorePlayInvalidResponseError(operation);
    }
  });
}

/** User-facing text for a failed read; never includes the upstream body. */
export function scorePlayReadMessage(err: ScorePlayHttpError): string {
  if (err.statusCode === 429) {
    return `ScorePlay is rate-limiting requests (${err.operation})${err.retryAfterSec ? `; try again in about ${err.retryAfterSec} s` : "; try again shortly"}`;
  }
  if (err.statusCode >= 500) return `ScorePlay is temporarily unavailable (${err.operation} → HTTP ${err.statusCode})`;
  return err.message;
}
