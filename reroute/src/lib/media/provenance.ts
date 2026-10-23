/**
 * Run-level provenance of upstream data (server-only). Every TwelveLabs / ScorePlay read reports whether it
 * was answered LIVE or from a demo recording (CACHED, with the recording date); `trackProvenance` collects
 * the reports made while one goal action runs, so the goal view can say LIVE, CACHED or MIXED.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export type RunProvenance = {
  origin: "LIVE" | "CACHED" | "MIXED";
  /** ISO time of the OLDEST recording served; present iff origin !== "LIVE". */
  recordedAt?: string;
};

/** Origin of one upstream read. `recordedAt` is required for CACHED. */
export type ReadOrigin = { origin: "LIVE" } | { origin: "CACHED"; recordedAt: string };

type Tracker = { live: boolean; cached: boolean; recordedAt?: string; parent?: Tracker };

const storage = new AsyncLocalStorage<Tracker>();

const older = (a: string | undefined, b: string | undefined): string | undefined => (a && b ? (a < b ? a : b) : (a ?? b));

/** Record one upstream read in every enclosing `trackProvenance` scope (no-op outside one). */
export function reportOrigin(read: ReadOrigin): void {
  for (let t = storage.getStore(); t; t = t.parent) {
    if (read.origin === "LIVE") t.live = true;
    else {
      t.cached = true;
      t.recordedAt = older(t.recordedAt, read.recordedAt);
    }
  }
}

function summarize(t: Tracker): RunProvenance | undefined {
  if (t.cached) return { origin: t.live ? "MIXED" : "CACHED", recordedAt: t.recordedAt };
  return t.live ? { origin: "LIVE" } : undefined;
}

/** Re-report a summary captured earlier (e.g. by a cached catalog that is reused without new reads). */
export function reportProvenance(p: RunProvenance | undefined): void {
  if (!p) return;
  if (p.origin !== "CACHED") reportOrigin({ origin: "LIVE" });
  if (p.origin !== "LIVE" && p.recordedAt) reportOrigin({ origin: "CACHED", recordedAt: p.recordedAt });
}

/**
 * Run `fn`, collecting the origin of every upstream read it makes (scopes nest: inner reads also count for
 * outer scopes). `provenance` is undefined when `fn` made no upstream read at all.
 */
export async function trackProvenance<T>(fn: () => Promise<T>): Promise<{ value: T; provenance: RunProvenance | undefined }> {
  const tracker: Tracker = { live: false, cached: false, parent: storage.getStore() };
  const value = await storage.run(tracker, fn);
  return { value, provenance: summarize(tracker) };
}

/** Combine the provenance of several actions of one run; undefined inputs (no reads) are ignored. */
export function mergeProvenance(a?: RunProvenance, b?: RunProvenance): RunProvenance | undefined {
  if (!a || !b) return a ?? b;
  const live = a.origin !== "CACHED" || b.origin !== "CACHED";
  const cached = a.origin !== "LIVE" || b.origin !== "LIVE";
  if (!cached) return { origin: "LIVE" };
  return { origin: live ? "MIXED" : "CACHED", recordedAt: older(a.recordedAt, b.recordedAt) };
}
