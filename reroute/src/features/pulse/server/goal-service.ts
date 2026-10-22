import { randomUUID } from "node:crypto";
import type { EditDecision, EditPlan, PublishIntent } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { decideEdit } from "@/lib/server/decide";
import { configuredDestination } from "../commerce";
import { buildGoalCampaign, rerouteRequestFor } from "../goal-campaign";
import { parseMatch } from "../goal-intents";
import { buildGoalView } from "../goal-view";
import { PRODUCTS, parseObjective } from "../objective-parser";
import type { Club, CommerceDestination, GoalRightsCheck, GoalRun, GoalView, Recommendation } from "../types";
import { searchGoal, type GoalSearch } from "./goal-search";
import { readPulse, transact } from "./store";

/**
 * The guided flow: goal → three real moments → campaign proposal → REROUTE verdict → another way.
 * Rights are only ever REROUTE's: every check, alternative and approval calls `decideEdit` afresh.
 */

export type GoalDeps = {
  search(input: { club: Club; objective: GoalRun["objective"]; match?: string }): Promise<GoalSearch>;
  decide(edit: EditPlan, intent: PublishIntent): Promise<EditDecision>;
  now(): Date;
};

const defaultDeps: GoalDeps = { search: (input) => searchGoal(input), decide: (edit, intent) => decideEdit(edit, intent), now: () => new Date() };

/** Goal runs kept in PULSE state; older ones are dropped. */
const MAX_RUNS = 20;
/** Alternatives REROUTE evaluates per "Find another way". */
const ALTERNATIVES = 3;

function present(run: GoalRun, now: Date): GoalView {
  return buildGoalView(run, (rec) => rerouteRequestFor(run, rec, now).intent);
}

async function loadRun(id: string): Promise<GoalRun> {
  const run = (await readPulse()).goals.find((g) => g.id === id);
  if (!run) throw new AppError("NOT_FOUND", `Goal ${id} not found`);
  return run;
}

/** Applies `mutate` to the latest stored copy, so concurrent verdicts are merged, not overwritten. */
function updateRun(id: string, mutate: (run: GoalRun) => void): Promise<GoalRun> {
  return transact((data) => {
    const run = data.goals.find((g) => g.id === id);
    if (!run) throw new AppError("NOT_FOUND", `Goal ${id} not found`);
    mutate(run);
    return { result: run, write: true };
  });
}

function recommendation(run: GoalRun, key: string): Recommendation {
  const rec = run.pool.find((r) => r.key === key);
  if (!rec) throw new AppError("BAD_REQUEST", "That moment is not one of this goal's results");
  return rec;
}

/** Records REROUTE's verdict as-is: every non-PERMIT reason with its dimension, and the request asked. */
async function evaluate(run: GoalRun, rec: Recommendation, deps: GoalDeps): Promise<GoalRightsCheck> {
  const { edit, intent, rerouteUrl } = rerouteRequestFor(run, rec, deps.now());
  const { decision } = await deps.decide(edit, intent);
  return {
    key: rec.key,
    state: decision.verdict,
    checkedAt: decision.evaluatedAt,
    scoreplayAssetId: rec.candidate.scoreplayAssetId,
    policyId: decision.policyId,
    policyVersion: decision.policyVersion,
    policyFictional: decision.policyFictional,
    reasons: decision.reasons.filter((r) => r.outcome !== "PERMIT").map(({ dimension, outcome, explanation }) => ({ dimension, outcome, explanation })),
    missingFacts: decision.missingFacts,
    edit,
    intent,
    rerouteUrl,
  };
}

export async function runGoal(goal: string, club: Club, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const submittedAt = deps.now();
  const objective = parseObjective(goal, submittedAt);
  if (!objective.market && !objective.product && objective.scope !== "GLOBAL") {
    throw new AppError(
      "BAD_REQUEST",
      "PULSE could not tell what this goal should achieve or for whom. Try: “Promote Tottenham merchandise to UK fans using the best moments from the Manchester United match.”",
    );
  }
  const match = parseMatch(goal);
  const found = await deps.search({ club, objective, match });
  const run: GoalRun = {
    id: `goal-${randomUUID().slice(0, 8)}`,
    schemaVersion: 1,
    club,
    submittedAt: submittedAt.toISOString(),
    resultsAt: deps.now().toISOString(),
    objective,
    match,
    ...found,
    rights: {},
  };
  await transact((data) => {
    data.goals = [...data.goals, run].slice(-MAX_RUNS);
    return { result: undefined, write: true };
  });
  return present(run, deps.now());
}

/** One goal run, or the latest when no id is given (null before the first goal). */
export async function getGoal(id?: string, deps: Pick<GoalDeps, "now"> = defaultDeps): Promise<GoalView | null> {
  const goals = (await readPulse()).goals;
  const run = id ? goals.find((g) => g.id === id) : goals.at(-1);
  if (id && !run) throw new AppError("NOT_FOUND", `Goal ${id} not found`);
  return run ? present(run, deps.now()) : null;
}

/** Selects a moment and (re)builds the campaign proposal for the run's unchanged objective. */
export async function draftGoalCampaign(id: string, key: string, commerceUrl: string | undefined, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await loadRun(id);
  const rec = recommendation(run, key);
  const product = run.objective.product?.key;
  const kind = product && PRODUCTS[product].commerce;
  if (commerceUrl && !kind) throw new AppError("BAD_REQUEST", "This goal has no store or ticketing destination.");
  const kept = run.campaign?.cta.destination?.source === "PRODUCER_ENTERED" ? run.campaign.cta.destination : undefined;
  const destination: CommerceDestination | undefined =
    product && kind
      ? commerceUrl
        ? { kind, url: commerceUrl, source: "PRODUCER_ENTERED" }
        : (kept ?? configuredDestination(run.club, product, kind, run.objective.market?.code))
      : undefined;
  const campaign = buildGoalCampaign({ run, rec, destination, now: deps.now(), previous: run.campaign });
  const saved = await updateRun(id, (r) => {
    r.selectedKey = key;
    r.campaign = campaign;
    if (r.approval?.key !== key) r.approval = undefined;
  });
  return present(saved, deps.now());
}

function selectedOf(run: GoalRun): Recommendation {
  if (!run.campaign || !run.selectedKey) throw new AppError("BAD_REQUEST", "Pick a moment and build its campaign first.");
  return recommendation(run, run.selectedKey);
}

/** Sends the selected moment, exactly as proposed, through REROUTE's decision. */
export async function checkGoalRights(id: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await loadRun(id);
  const check = await evaluate(run, selectedOf(run), deps);
  const saved = await updateRun(id, (r) => {
    r.rights[check.key] = check;
  });
  return present(saved, deps.now());
}

/**
 * "Find another way": keeps the objective, takes the next-best moments PULSE already ranked for it —
 * other assets first, since rights problems are usually per asset — and has REROUTE evaluate each one
 * independently. Verdicts are recorded exactly as returned; nothing is promoted to cleared.
 */
export async function findAlternatives(id: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await loadRun(id);
  const current = selectedOf(run);
  const verdict = run.rights[current.key];
  if (!verdict) throw new AppError("BAD_REQUEST", "Check rights with REROUTE first.");
  if (verdict.state === "ALLOWED") throw new AppError("BAD_REQUEST", "REROUTE allowed this moment; there is nothing to route around.");

  const tried = new Set([current.key, ...Object.keys(run.rights)]);
  const troubled = new Set(Object.values(run.rights).filter((c) => c.state !== "ALLOWED").map((c) => c.scoreplayAssetId));
  const open = run.pool.filter((r) => !tried.has(r.key));
  const next = [...open.filter((r) => !troubled.has(r.candidate.scoreplayAssetId)), ...open.filter((r) => troubled.has(r.candidate.scoreplayAssetId))].slice(0, ALTERNATIVES);
  const checks = await Promise.all(next.map((rec) => evaluate(run, rec, deps)));

  const saved = await updateRun(id, (r) => {
    for (const c of checks) r.rights[c.key] = c;
    // Alternatives accumulate for the goal: earlier ones stay visible after switching to one of them.
    const previous = r.recovery?.keys ?? [];
    r.recovery = {
      requestedAt: deps.now().toISOString(),
      forKey: current.key,
      keys: [...new Set([...previous, ...checks.map((c) => c.key)])],
      exhausted: open.length <= next.length,
    };
  });
  return present(saved, deps.now());
}

/**
 * Human approval of the selected proposal. REROUTE is asked again first; approval needs ALLOWED under
 * a real (non-fictional) policy and a club-approved destination when the goal sells something.
 */
export async function approveGoalCampaign(id: string, reviewer: string, deps: GoalDeps = defaultDeps): Promise<GoalView> {
  const run = await loadRun(id);
  const rec = selectedOf(run);
  const check = await evaluate(run, rec, deps);
  const cleared = check.state === "ALLOWED" && !check.policyFictional;
  const ready = run.campaign!.cta.status !== "NOT_CONFIGURED";
  const saved = await updateRun(id, (r) => {
    r.rights[check.key] = check;
    if (cleared && ready) r.approval = { key: rec.key, by: reviewer, at: deps.now().toISOString() };
  });
  if (!cleared) {
    throw new AppError(
      "FORBIDDEN",
      check.state === "ALLOWED"
        ? `REROUTE allowed this under ${check.policyId}, a fictional demo policy — that is not a rights clearance, so it cannot be approved.`
        : `REROUTE verdict is ${check.state}; only a cleared moment can be approved.`,
    );
  }
  if (!ready) throw new AppError("BAD_REQUEST", "Add the club-approved destination URL before approval.");
  return present(saved, deps.now());
}
