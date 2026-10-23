"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { describeError } from "@/lib/api-client";
import { pulseApi } from "../client";
import { OpportunityPreflightSchema, type GoalView, type OpportunityPreflight, type RecommendationView } from "../types";
import type { PreflightApi, PreflightState } from "./preflight-state";

/**
 * Selection-time rights preflight of every recommended moment (POST /api/pulse/preflight). States are keyed by the
 * card's `preflightBasis`: a changed basis (policy switch, plan narrowed, new cut) is a new request and an older result
 * is never shown for it. One independent request per card, each with its own timeout. Finished results survive
 * reloads in sessionStorage (per run, schema-validated on read). Lives in PulseStudio so it survives step navigation.
 */

const TIMEOUT_MS = 90_000;
const TIMEOUT_MESSAGE = "The check took too long — open the campaign and run Check rights";
const CHANGED_MESSAGE = "The goal changed while REROUTE was checking this moment — check again.";

type Card = Pick<RecommendationView, "key" | "preflightBasis">;
type States = Record<string, PreflightState>;

const storageKey = (runId: string) => `pulse:preflight:${runId}`;

/** Stored results of one run; anything that fails the contract (or sits under another basis) is ignored. */
function readStored(runId: string): States {
  try {
    const raw = window.sessionStorage.getItem(storageKey(runId));
    const json: unknown = raw ? JSON.parse(raw) : null;
    if (!json || typeof json !== "object") return {};
    const out: States = {};
    for (const [basis, value] of Object.entries(json)) {
      const parsed = OpportunityPreflightSchema.safeParse(value);
      if (parsed.success && parsed.data.basis === basis) out[basis] = { status: "done", result: parsed.data };
    }
    return out;
  } catch {
    return {};
  }
}

function store(runId: string, result: OpportunityPreflight): void {
  try {
    const raw = window.sessionStorage.getItem(storageKey(runId));
    const json: unknown = raw ? JSON.parse(raw) : null;
    const prev = json && typeof json === "object" && !Array.isArray(json) ? json : {};
    window.sessionStorage.setItem(storageKey(runId), JSON.stringify({ ...prev, [result.basis]: result }));
  } catch {
    // Storage unavailable/full or corrupt: the result still lives in memory for this page.
  }
}

export function usePreflight(goal: GoalView | null, opts: { enabled: boolean }): PreflightApi {
  const [states, setStates] = useState<States>({});
  // Source of truth, updated synchronously (dedupe and "has a state" checks must not wait for a render).
  const statesRef = useRef<States>({});
  const inflight = useRef(new Set<string>());
  const hydrated = useRef(new Set<string>());
  const runIdRef = useRef<string | null>(null);

  const commit = useCallback((next: States) => {
    statesRef.current = next;
    setStates(next);
  }, []);

  const put = useCallback(
    (basis: string, state: PreflightState | undefined) => {
      const next = { ...statesRef.current };
      if (state) next[basis] = state;
      else delete next[basis];
      commit(next);
    },
    [commit],
  );

  const start = useCallback(
    (runId: string, card: Card) => {
      const basis = card.preflightBasis;
      if (inflight.current.has(basis)) return;
      inflight.current.add(basis);
      put(basis, { status: "checking", startedAt: Date.now() });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      pulseApi
        .preflight(runId, card.key, controller.signal)
        .then((result) => {
          store(runId, result);
          put(result.basis, { status: "done", result });
          // The run changed under the request: the result belongs to its own basis, never to this one.
          if (result.basis !== basis) put(basis, { status: "unavailable", message: CHANGED_MESSAGE });
        })
        .catch((err: unknown) => {
          put(basis, { status: "unavailable", message: controller.signal.aborted ? TIMEOUT_MESSAGE : describeError(err).detail });
        })
        .finally(() => {
          clearTimeout(timer);
          inflight.current.delete(basis);
        });
    },
    [put],
  );

  useEffect(() => {
    runIdRef.current = goal?.run.id ?? null;
    if (!goal || !opts.enabled) return;
    const runId = goal.run.id;
    if (!hydrated.current.has(runId)) {
      hydrated.current.add(runId);
      const saved = readStored(runId);
      if (Object.keys(saved).length) commit({ ...saved, ...statesRef.current });
    }
    for (const rec of goal.recommendations) {
      if (!statesRef.current[rec.preflightBasis]) start(runId, rec);
    }
  }, [goal, opts.enabled, start, commit]);

  const retry = useCallback(
    (card: Card) => {
      const runId = runIdRef.current;
      if (!runId || inflight.current.has(card.preflightBasis)) return;
      start(runId, card);
    },
    [start],
  );

  return useMemo<PreflightApi>(() => ({ get: (card) => states[card.preflightBasis], retry }), [states, retry]);
}
