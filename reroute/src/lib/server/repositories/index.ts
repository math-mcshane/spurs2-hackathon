import "server-only";
import { activeRepositories } from "./registry";
import type { Repositories } from "./types";

/**
 * Server-only persistence (Supabase). Each export forwards to the active backend at call time, so a
 * missing SUPABASE_URL / SUPABASE_SECRET_KEY surfaces as AppError NOT_CONFIGURED on first use.
 */

/** `methods` must list every method of the port (checked at compile time), so nothing is silently unforwarded. */
function forward<K extends keyof Repositories>(key: K, methods: Record<keyof Repositories[K], true>): Repositories[K] {
  return Object.fromEntries(
    Object.keys(methods).map((method) => [
      method,
      (...args: unknown[]) => {
        const repo = activeRepositories()[key];
        return Reflect.apply(Reflect.get(repo, method) as (...a: unknown[]) => unknown, repo, args);
      },
    ]),
  ) as unknown as Repositories[K]; // every key of the port is present (enforced by `methods`)
}

export const goalRuns = forward("goalRuns", { create: true, get: true, getVersioned: true, latest: true, update: true });
export const campaigns = forward("campaigns", {
  saveVersion: true,
  get: true,
  findByGoalRun: true,
  findByOpportunity: true,
  listVersions: true,
  setState: true,
});
export const evaluations = forward("evaluations", { record: true, listForCampaign: true });
export const alternatives = forward("alternatives", { record: true, listForEvaluation: true });
export const events = forward("events", { append: true, list: true, verifyChain: true });
export const writebackAttempts = forward("writebackAttempts", { record: true, listForReceipt: true });
export const observationCache = forward("observationCache", { get: true, put: true });
/** Storage primitives for `lib/server/store.ts`; other modules use the store's receipt API. */
export const receiptRecords = forward("receipts", {
  insert: true,
  load: true,
  compareAndSet: true,
  latestForCampaign: true,
  findForEdit: true,
  addReview: true,
  listReviews: true,
});
export const humanObservationRecords = forward("humanObservations", { add: true, list: true });
export const policyPackages = forward("policyPackages", { insert: true, list: true, get: true, getSelection: true, setSelection: true });

export type * from "./types";
