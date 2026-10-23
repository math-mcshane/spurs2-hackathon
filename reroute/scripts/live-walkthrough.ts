/**
 * Live end-to-end walkthrough of the product flow through the service layer:
 * goal → three real moments → proposal → REROUTE evaluation (every channel × territory) → "Find a way to
 * use it" (recovery engine) → recommended option applied + independent re-check, or licence gap / no path →
 * human-review receipt → ScorePlay writeback plan
 * (DRY-RUN, printed only). Prints a compact transcript with wall-clock timings per step.
 *
 *   pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/live-walkthrough.ts [A B C D E]
 *
 * External calls are read-only (ScorePlay GET/search, TwelveLabs list/search). Writes go only to the
 * LOCAL Supabase (refuses any other SUPABASE_URL). Never prints secrets; never downloads media.
 */
import { AppError } from "../src/lib/errors";
import { getReceipt } from "../src/lib/server/store";
import { planWriteback, toScorePlayActions, writebackMode } from "../src/lib/scoreplay/writeback";
import { clock } from "../src/features/pulse/moment-ranking";
import * as goals from "../src/features/pulse/server/goal-service";
import type { Club, GoalView } from "../src/features/pulse/types";

const SCENARIOS: { name: string; goal: string; club: Club }[] = [
  { name: "A", goal: "Promote Tottenham merchandise to UK supporters", club: "tottenham" },
  { name: "B", goal: "Maximize global engagement from the Manchester United game", club: "tottenham" },
  { name: "C", goal: "Sell more Spurs jerseys in Mexico", club: "tottenham" },
  { name: "D", goal: "Sell tickets for the next home game", club: "tottenham" },
  { name: "E", goal: "Activate our sleeve sponsor with fans in the UK", club: "tottenham" },
];

const out = (s = "") => console.log(s);

function assertLocalSupabase() {
  const url = process.env.SUPABASE_URL ?? "";
  const host = url ? new URL(url).hostname : "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new AppError("NOT_CONFIGURED", `Refusing to run: SUPABASE_URL must point to the local Supabase (got host "${host || "unset"}").`);
  }
}

/** Runs one service action and reports its wall-clock time (measured here, never estimated). */
async function timed(label: string, fn: () => Promise<GoalView>): Promise<GoalView> {
  const t0 = performance.now();
  const v = await fn();
  out(`  [${label} ${((performance.now() - t0) / 1000).toFixed(1)}s]`);
  return v;
}

function rights(v: GoalView): string {
  const r = v.rights;
  const t = { ALLOWED: 0, NEEDS_REVIEW: 0, BLOCKED: 0 };
  for (const p of r.perIntent) t[p.verdict]++;
  const policies = [...new Set(r.perIntent.map((p) => `${p.policyId}${p.policyFictional ? " (fictional)" : ""}`))].join(", ");
  return `${r.state} · clearance ${r.clearance ?? "-"} · ${r.kind ?? "-"} v${r.campaignVersion ?? "-"} · ${r.perIntent.length} uses: ${t.ALLOWED} allowed / ${t.NEEDS_REVIEW} review / ${t.BLOCKED} blocked · policy ${policies}${r.clearanceLabel ? ` · ${r.clearanceLabel}` : ""}`;
}

function topIssues(v: GoalView): string[] {
  return v.rights.issues.slice(0, 3).map((i) => `${i.outcome} ${i.topic}: ${i.explanations[0]}`);
}

async function scenario(s: (typeof SCENARIOS)[number]) {
  out(`\n=== Scenario ${s.name}: “${s.goal}” (club ${s.club}) ===`);
  let v = await timed("run", () => goals.runGoal(s.goal, s.club));
  const p = v.run.plan;
  const o = v.run.objective;
  out(`objective: ${o.summary} · market ${o.market?.code ?? "-"} · product ${o.product?.key ?? "-"} · missing ${o.missing.join(",") || "-"}`);
  out(`plan: ${p.usage} · ${p.scope} · territories ${p.territories.join(",")} · channels ${p.channels.join(",")} · ${p.competition}`);
  out(`match: ${v.run.match ?? "-"}${v.run.matchFilter ? ` → ${v.run.matchFilter.status} (${v.run.matchFilter.videos} videos)` : ""} · data ${v.dataOrigin ? `${v.dataOrigin.origin}${v.dataOrigin.recordedAt ? ` (recorded ${v.dataOrigin.recordedAt})` : ""}` : "-"}`);
  out(`search: ${v.run.search.status} — ${v.run.search.message}`);
  out(`questions: ${v.run.intents.map((i) => i.label).join(" | ")}`);
  v.recommendations.forEach((r, i) => {
    const c = r.candidate;
    out(
      `  #${i + 1} ${r.headline} · score ${r.score} · SP ${c.scoreplayAssetId} / TL ${r.media.twelvelabsVideoId} (${r.media.method}) · ` +
        `${c.startSeconds?.toFixed(2)}s–${c.endSeconds?.toFixed(2)}s (${clock(c.startSeconds ?? 0)}–${clock(c.endSeconds ?? 0)}) · “${c.title}”${r.duplicates.length ? ` · ${r.duplicates.length} duplicate(s) folded` : ""}`,
    );
  });
  if (!v.campaign) {
    out(`no proposal: ${v.nextStep}`);
    return;
  }
  const c = v.campaign;
  out(`proposal: v${c.version} · ${c.intents.length} uses · copy ${c.audience.locale ?? c.audience.language} · CTA “${c.cta.text}” ${c.cta.status} · goal→proposal ${v.timing.toProposalSec}s (results ${v.timing.toRecommendationsSec}s)`);
  out(`  angle: ${c.creative.angle}`);
  out(`  copy (instagram): ${c.channels[0].copy.replace(/\n+/g, " ⏎ ")}`);
  out(`  KPI: ${v.kpi.label} → “${v.kpi.valueText}”`);
  const missing = c.checklist.filter((i) => i.status !== "DONE").map((i) => `${i.item} ${i.status}`);
  if (missing.length) out(`  checklist open: ${missing.join(" · ")}`);

  const at = (g: GoalView) => ({ id: g.run.id, expectedVersion: g.version });
  v = await timed("check", () => goals.checkGoalRights(at(v)));
  out(`rights: ${rights(v)}`);
  for (const i of topIssues(v)) out(`  - ${i}`);

  // Walk the other recommendations until REROUTE identifies a restriction (or none does).
  for (const rec of v.recommendations.slice(1)) {
    if (v.rights.state !== "ALLOWED") break;
    v = await goals.selectMoment(at(v), rec.key);
    v = await timed("check", () => goals.checkGoalRights(at(v)));
    out(`select ${rec.key} → v${v.campaign!.version}: ${rights(v)}`);
    for (const i of topIssues(v)) out(`  - ${i}`);
  }

  if (v.rights.state !== "ALLOWED") {
    v = await timed("find a way to use it", () => goals.findRecovery(at(v)));
    const r = v.recovery;
    if (r) {
      out(`recovery: ${r.scope} · ${r.problem.headline}`);
      for (const pr of r.problem.items.slice(0, 3)) out(`  problem: ${pr.text} [${pr.source}]`);
      for (const o of r.options) {
        const recheck = o.recheck ? ` · recheck ${o.recheck.allowedUses}/${o.recheck.totalUses} ${o.recheck.verdict}` : "";
        out(`  ${o.id === r.recommendedId ? "*" : "-"} ${o.id} · ${o.kind} ${o.outcome} · “${o.title}”${recheck}${o.notViableBecause ? ` · not viable: ${o.notViableBecause}` : ""}`);
      }
      if (r.noPathMessage) out(`  no path: ${r.noPathMessage}`);
    }
    if (v.nextStep.startsWith("No licence covers")) out(`licence gap: ${v.nextStep}`);
    const pick = r?.recommendedId;
    if (pick) {
      v = await timed("apply recovery", () => goals.applyRecovery(at(v), pick));
      const ba = v.beforeAfter;
      out(`applied ${pick} → v${v.campaign!.version} (${v.campaign!.origin}, ${v.campaign!.intents.length} uses), independent re-check: ${rights(v)}`);
      if (ba) out(`  before ${ba.before.verdict} ${ba.before.allowedUses}/${ba.before.totalUses} → after ${ba.after ? `${ba.after.verdict} ${ba.after.allowedUses}/${ba.after.totalUses}` : "-"}`);
      if (v.edit) out(`  edit: kept ${v.edit.retained.map((x) => `${x.start}–${x.end}`).join(", ")} (${v.edit.resultDurationSec}s of ${v.edit.originalDurationSec}s) · ${v.edit.executionLabel}`);
    }
  }

  if (v.canSubmit) {
    v = await goals.submitForReview(at(v));
    out(`review: receipt ${v.receiptId} · ${v.reviewStatus} · publishable ${v.publishable}`);
    const receipt = await getReceipt(v.receiptId!);
    const mode = writebackMode(receipt);
    out(`writeback plan (${mode.mode === "LIVE" ? "LIVE" : `${mode.status}${mode.refusedReason ? `: ${mode.refusedReason}` : ""}`}): ${toScorePlayActions(planWriteback(receipt)).length} ScorePlay action(s) — printed only, nothing sent`);
  } else {
    out(`review: not submitted (${v.rights.state}${v.nextStep.startsWith("No licence covers") ? ", licence gap" : ""})`);
  }
  out(`next: ${v.nextStep}`);
  out(`evaluations: ${v.evaluations.map((e) => `${e.kind}:v${e.campaignVersion}:${e.verdict}/${e.clearance}`).join(" → ")}`);
}

async function main() {
  assertLocalSupabase();
  const only = new Set(process.argv.slice(2).map((a) => a.toUpperCase()));
  for (const s of SCENARIOS) if (!only.size || only.has(s.name)) await scenario(s);
}

main().catch((err) => {
  const code = err instanceof AppError ? err.code : "ERROR";
  console.error(`[${code}] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
