/**
 * Records the REAL upstream reads behind the flagship demo scenarios into `demo-cache/` (committed), so the
 * demo can replay them (`DEMO_REPLAY=true`) or fall back to them when TwelveLabs / ScorePlay are unavailable.
 *
 *   pnpm exec tsx --conditions=react-server --env-file=.env.local scripts/record-demo-cache.ts [A B C]
 *   … scripts/record-demo-cache.ts --sanitize   # re-apply the current sanitizer to demo-cache/ offline, then verify
 *
 * Scenarios = the Studio's brief library (club tottenham): A merchandise UK, B global engagement, C jerseys Mexico,
 * D tickets, E sleeve-sponsor activation, F jerseys UK, G UK followers. Each is walked through every moment:
 * select → rights check → "Find a way to use it" → the recommended option, if any → independent re-check.
 *
 * Read-only upstream (TwelveLabs list/search/analyze, ScorePlay GET + POST /media/search); goal runs are
 * written only to the LOCAL Supabase (refuses any other SUPABASE_URL). Records JSON metadata only: EVERY URL
 * (media, thumbnails, transcripts) and token-like values are removed before writing (lib/media/replay `redact`);
 * previews are never recorded. The recording is then verified by running the same walk in a FRESH process
 * under DEMO_REPLAY=true (no warm in-memory caches): any missing recording fails the run. Only then, and
 * only with a clean secret scan, does it replace `demo-cache/`. Never prints secrets; never downloads media.
 */
import { spawnSync } from "node:child_process";
import { cp, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AppError } from "../src/lib/errors";
import { redact } from "../src/lib/media/replay";
import * as goals from "../src/features/pulse/server/goal-service";
import type { Club, GoalView } from "../src/features/pulse/types";

const SCENARIOS: { name: string; goal: string; club: Club }[] = [
  { name: "A", goal: "Promote Tottenham merchandise to UK supporters", club: "tottenham" },
  { name: "B", goal: "Maximize global engagement from the Manchester United game", club: "tottenham" },
  { name: "C", goal: "Sell more Spurs jerseys in Mexico", club: "tottenham" },
  { name: "D", goal: "Sell tickets for the next home game", club: "tottenham" },
  { name: "E", goal: "Activate our sleeve sponsor with fans in the UK", club: "tottenham" },
  { name: "F", goal: "Sell Tottenham jerseys to UK fans", club: "tottenham" },
  { name: "G", goal: "Get more followers in the UK", club: "tottenham" },
  { name: "H", goal: "Grow engagement with Spurs fans in France", club: "spurs" },
];

/** What must never be in a committed fixture: any URL (protected footage links), storage locators, e-mails, or token-like material. */
const FORBIDDEN = [
  /[a-z][a-z0-9+.-]*:\/\//i,
  /\bwww\.[a-z0-9-]+\./i,
  /amazonaws\.com|cdn\.scoreplay\.io/i,
  /[^\s@"]+@[^\s@"]+\.[a-z]{2,}/i,
  /"(aws_[a-z_]*|[a-z_]*bucket[a-z_]*)"\s*:/i,
  /tlk_[A-Za-z0-9]/,
  /sb_(secret|publishable)_/,
  /"[^"]*(token|signature|api[-_]?key|secret|password)[^"]*"\s*:/i,
  /X-Amz-|Signature=|Key-Pair-Id/,
];

const out = (s = "") => console.log(s);
const at = (g: GoalView) => ({ id: g.run.id, expectedVersion: g.version });
const origin = (v: GoalView) => (v.dataOrigin ? `${v.dataOrigin.origin}${v.dataOrigin.recordedAt ? ` @ ${v.dataOrigin.recordedAt}` : ""}` : "-");

function assertLocalSupabase() {
  const url = process.env.SUPABASE_URL ?? "";
  const host = url ? new URL(url).hostname : "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new AppError("NOT_CONFIGURED", `Refusing to run: SUPABASE_URL must point to the local Supabase (got host "${host || "unset"}").`);
  }
}

/** The demo walk. Returns one summary line per step; the last line is the run's data origin. */
async function walk(s: (typeof SCENARIOS)[number]): Promise<string[]> {
  const log: string[] = [];
  let v = await goals.runGoal(s.goal, s.club);
  log.push(`run: ${v.run.search.status} · ${v.recommendations.length} moment(s) · data ${origin(v)}`);
  if (v.campaign) {
    for (const [i, rec] of v.recommendations.entries()) {
      if (i > 0) v = await goals.selectMoment(at(v), rec.key);
      v = await goals.checkGoalRights(at(v));
      log.push(`  “${rec.candidate.title}”: ${v.rights.state} (${v.rights.perIntent.length} uses)`);
      if (v.rights.state === "ALLOWED") continue;
      v = await goals.findRecovery(at(v));
      const r = v.recovery;
      const opts = r?.options ?? [];
      log.push(`    recovery ${r?.scope ?? "-"} · ${opts.length} option(s): ${opts.map((o) => `${o.kind} ${o.outcome}${o.recheck ? ` ${o.recheck.allowedUses}/${o.recheck.totalUses}` : ""}`).join(", ") || "-"}`);
      if (r?.recommendedId) {
        const pick = opts.find((o) => o.id === r.recommendedId)!;
        v = await goals.applyRecovery(at(v), pick.id);
        log.push(`    applied ${pick.kind} “${pick.title}” → ${v.rights.state} (${v.rights.perIntent.length} uses)`);
      } else if (v.nextStep.startsWith("No licence covers")) {
        log.push(`    licence gap: ${v.nextStep}`);
      } else if (r?.noPathMessage) {
        log.push(`    no path: ${r.noPathMessage}`);
      }
    }
  }
  log.push(`data origin: ${origin(v)}`);
  return log;
}

async function files(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch(() => []);
  return entries.filter((e) => e.isFile() && e.name.endsWith(".json")).map((e) => path.join(e.parentPath, e.name));
}

async function scan(dir: string): Promise<string[]> {
  const bad: string[] = [];
  for (const f of await files(dir)) {
    const text = await readFile(f, "utf8");
    for (const re of FORBIDDEN) if (re.test(text)) bad.push(`${path.relative(dir, f)} matches ${re}`);
  }
  return bad;
}

/** Replay every chosen scenario from `dir` in a FRESH process (no warm caches); throws on any miss. */
function verifyReplay(dir: string, names: string[]): void {
  const child = spawnSync(
    "pnpm",
    ["exec", "tsx", "--conditions=react-server", "--env-file=.env.local", "scripts/record-demo-cache.ts", "--verify", ...names],
    { stdio: "inherit", env: { ...process.env, DEMO_RECORD: "", DEMO_REPLAY: "true", DEMO_CACHE_DIR: dir } },
  );
  if (child.status !== 0) throw new AppError("INTERNAL", `Replay verification failed (exit ${child.status}); demo-cache left unchanged, staging at ${dir}`);
}

/** Scan, verify, then replace `target` with `staging` (`replace`: drop recordings not in staging). */
async function publish(staging: string, target: string, names: string[], replace: boolean): Promise<void> {
  const bad = await scan(staging);
  if (bad.length) throw new AppError("INTERNAL", `Refusing to write demo-cache: ${bad.length} forbidden pattern(s):\n${bad.slice(0, 20).join("\n")}`);
  verifyReplay(staging, names);
  if (replace) await rm(target, { recursive: true, force: true });
  await cp(staging, target, { recursive: true });
  await rm(staging, { recursive: true, force: true });
  out(`\ndemo-cache updated: ${(await files(target)).length} file(s) in demo-cache/ — secret scan clean, replay verified`);
}

async function main() {
  assertLocalSupabase();
  const args = process.argv.slice(2);
  const names = args.filter((a) => !a.startsWith("--")).map((a) => a.toUpperCase());
  const chosen = SCENARIOS.filter((s) => !names.length || names.includes(s.name));

  if (args.includes("--verify")) {
    // Child process (spawned by verifyReplay): every read must be answered by the staged recording.
    if (process.env.DEMO_REPLAY !== "true" || !process.env.DEMO_CACHE_DIR) {
      throw new AppError("BAD_REQUEST", "--verify runs only under DEMO_REPLAY=true with DEMO_CACHE_DIR set");
    }
    for (const s of chosen) {
      out(`\n=== replay ${s.name} ===`);
      const log = await walk(s);
      for (const line of log) out(line);
      if (!log.at(-1)?.startsWith("data origin: CACHED")) throw new AppError("INTERNAL", `Scenario ${s.name} did not replay entirely from the recording`);
    }
    return;
  }

  const target = path.join(process.cwd(), "demo-cache");
  const staging = await mkdtemp(path.join(os.tmpdir(), "reroute-demo-cache-"));

  if (args.includes("--sanitize")) {
    // Offline: no upstream call. File names (request keys) are unchanged; request + value are re-redacted.
    await cp(target, staging, { recursive: true });
    for (const f of await files(staging)) {
      const r: { request: unknown; value: unknown } = JSON.parse(await readFile(f, "utf8"));
      await writeFile(f, `${JSON.stringify({ ...r, request: redact(r.request), value: redact(r.value) }, null, 2)}\n`);
    }
    out(`sanitized ${(await files(staging)).length} recording(s)`);
    await publish(staging, target, names, true);
    return;
  }

  // Record: live reads; each successful one is written (redacted) to the staging dir.
  delete process.env.DEMO_REPLAY;
  process.env.DEMO_RECORD = "true";
  process.env.DEMO_CACHE_DIR = staging;
  for (const s of chosen) {
    out(`\n=== record ${s.name}: “${s.goal}” ===`);
    for (const line of await walk(s)) out(line);
  }
  out(`\nrecorded ${(await files(staging)).length} response(s)`);
  // A full run replaces the committed recording; a partial run adds to it.
  await publish(staging, target, names, !names.length);
}

main().catch((err) => {
  const code = err instanceof AppError ? err.code : "ERROR";
  console.error(`[${code}] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
