/**
 * Live end-to-end walkthrough of the product flow through the service layer, for Scenario A and B:
 * goal → three real moments → proposal → REROUTE evaluation (every channel × territory) → "Find another
 * way" → independent re-check → human-review receipt → ScorePlay writeback plan (DRY-RUN, printed only).
 *
 *   pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/live-walkthrough.ts
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
];

const out = (s = "") => console.log(s);

function assertLocalSupabase() {
  const url = process.env.SUPABASE_URL ?? "";
  const host = url ? new URL(url).hostname : "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new AppError("NOT_CONFIGURED", `Refusing to run: SUPABASE_URL must point to the local Supabase (got host "${host || "unset"}").`);
  }
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
  let v = await goals.runGoal(s.goal, s.club);
  const p = v.run.plan;
  out(`plan: ${p.usage} · ${p.scope} · territories ${p.territories.join(",")} · channels ${p.channels.join(",")} · ${p.competition}`);
  out(`match: ${v.run.match ?? "-"}${v.run.matchFilter ? ` → ${v.run.matchFilter.status} (${v.run.matchFilter.videos} videos)` : ""}`);
  out(`search: ${v.run.search.status} — ${v.run.search.message}`);
  out(`questions: ${v.run.intents.map((i) => i.label).join(" | ")}`);
  v.recommendations.forEach((r, i) => {
    const c = r.candidate;
    out(
      `  #${i + 1} ${r.headline} · score ${r.score} · SP ${c.scoreplayAssetId} / TL ${r.media.twelvelabsVideoId} (${r.media.method}) · ` +
        `${c.startSeconds}s–${c.endSeconds}s (${clock(c.startSeconds ?? 0)}–${clock(c.endSeconds ?? 0)}) · “${c.title}”${r.duplicates.length ? ` · ${r.duplicates.length} duplicate(s) folded` : ""}`,
    );
    out(`     why: ${r.why.opportunity}`);
  });
  if (!v.campaign) {
    out(`no proposal: ${v.nextStep}`);
    return;
  }
  out(`proposal: campaign ${v.campaign.campaignId} v${v.campaign.version} · ${v.campaign.intents.length} uses · CTA ${v.campaign.cta.status} · time to proposal ${v.timing.toProposalSec}s (results ${v.timing.toRecommendationsSec}s)`);
  out(`  hook: ${v.campaign.creative.hook} · KPI: ${v.kpi.label} (value ${v.kpi.value})`);

  v = await goals.checkGoalRights(v.run.id);
  out(`rights: ${rights(v)}`);
  for (const i of topIssues(v)) out(`  - ${i}`);

  // Walk the other recommendations until REROUTE identifies a restriction (or none does).
  for (const rec of v.recommendations.slice(1)) {
    if (v.rights.state !== "ALLOWED") break;
    v = await goals.selectMoment(v.run.id, rec.key);
    v = await goals.checkGoalRights(v.run.id);
    out(`select ${rec.key} → v${v.campaign!.version}: ${rights(v)}`);
    for (const i of topIssues(v)) out(`  - ${i}`);
  }

  if (v.rights.state !== "ALLOWED") {
    v = await goals.findAlternatives(v.run.id);
    const b = v.blocker;
    out(`blocker: ${b ? `${b.scope} [${b.dimensions.join(",")}] ${b.explanation}${b.suggestion ? ` → ${b.suggestion}` : ""}` : "-"}`);
    const alts = v.alternatives?.candidates ?? [];
    out(`alternatives (query “${v.alternatives?.query ?? "-"}”): ${alts.length}`);
    for (const a of alts) out(`  ${a.key} · ${a.verdict} · clearance ${a.clearance}${a.eligible ? " · eligible" : ""}`);
    const pick = alts.find((a) => a.eligible) ?? alts.find((a) => a.verdict !== "BLOCKED");
    if (pick && b?.scope !== "CAMPAIGN") {
      v = await goals.useAlternative(v.run.id, pick.key);
      out(`alternative ${pick.key} → new version v${v.campaign!.version}, independent re-check: ${rights(v)}`);
    }
  }

  if (v.canSubmit) {
    v = await goals.submitForReview(v.run.id);
    out(`review: receipt ${v.receiptId} · ${v.reviewStatus} · publishable ${v.publishable} · ${v.publishNote}`);
    const receipt = await getReceipt(v.receiptId!);
    const mode = writebackMode(receipt);
    out(`writeback plan (${JSON.stringify(mode)}): ${toScorePlayActions(planWriteback(receipt)).length} ScorePlay action(s) — printed only, nothing sent`);
  } else {
    out(`review: not submittable (${v.rights.state})`);
  }
  out(`next: ${v.nextStep}`);
  out(`evaluations: ${v.evaluations.map((e) => `${e.kind}:v${e.campaignVersion}:${e.verdict}/${e.clearance}`).join(" → ")}`);
}

async function main() {
  assertLocalSupabase();
  for (const s of SCENARIOS) await scenario(s);
}

main().catch((err) => {
  const code = err instanceof AppError ? err.code : "ERROR";
  console.error(`[${code}] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
