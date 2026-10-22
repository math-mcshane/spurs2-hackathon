"use client";

import Link from "next/link";
import { ExternalLinkIcon, WrenchIcon } from "lucide-react";
import type { MediaRef, Reason } from "@/lib/contracts";
import { OriginBadge } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import { CLUBS } from "../clubs";
import { RANKING, clock } from "../moment-ranking";
import { when } from "../pulse-ui";
import type { GoalView } from "../types";
import { CHANNEL_LABEL, duration } from "./parts";

const OUTCOME_CLS: Record<Reason["outcome"], string> = { DENY: "text-red-300", MISSING: "text-amber-300", PERMIT: "text-emerald-300" };

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-1 text-[10px] font-semibold tracking-[0.16em] text-zinc-400 uppercase">{children}</h4>;
}

/** `/desk` deep link for the current cut and first checked use. */
function deskHref(goal: GoalView): string {
  const c = goal.campaign;
  if (!c) return "/desk";
  const i = c.intents[0];
  const p = new URLSearchParams({ asset: c.media.scoreplayAssetId, start: String(c.media.startSeconds), end: String(c.media.endSeconds), club: c.plan.club });
  if (i) {
    p.set("territory", i.territory);
    p.set("platform", i.platform);
    p.set("usage", i.usage);
    p.set("competition", i.competition);
    p.set("publishAt", i.publishAt);
  }
  return `/desk?${p}`;
}

function MappingRow({ label, m }: { label: string; m: MediaRef }) {
  return (
    <tr className="border-t border-white/5 align-top">
      <td className="py-1 pr-2 text-zinc-300">{label}</td>
      <td className="py-1 pr-2 font-mono">{m.scoreplayMediaId ?? "—"}</td>
      <td className="py-1 pr-2 font-mono">{m.twelvelabsVideoId ?? "—"}</td>
      <td className={cn("py-1 pr-2 font-mono", m.method === "AMBIGUOUS" || m.method === "UNMAPPED" ? "text-amber-300" : "text-zinc-300")}>{m.method}</td>
      <td className="py-1 pr-2 break-all">{m.match?.scoreplayFilename ?? m.match?.twelvelabsFilename ?? "—"}</td>
      <td className="py-1 font-mono">{m.match?.durationDeltaSec !== undefined ? `${m.match.durationDeltaSec.toFixed(3)} s` : "—"}</td>
    </tr>
  );
}

/** Technical detail for judges and engineers. Collapsed by default; nothing here is needed to use the product. */
export function Diagnostics({ goal }: { goal: GoalView }) {
  const r = goal.run;
  const c = goal.campaign;
  return (
    <details className="group rounded-xl border border-white/8 bg-zinc-950/40 text-[11px] text-zinc-400">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3 text-xs text-zinc-400 hover:text-zinc-200">
        <WrenchIcon className="size-3.5" aria-hidden /> Diagnostics — how this was decided
      </summary>
      <div className="space-y-5 border-t border-white/5 px-4 py-4">
        <section>
          <H>Data provenance</H>
          <ul className="space-y-1">
            {goal.recommendations.map((rec, n) => (
              <li key={rec.key} className="flex flex-wrap items-center gap-2">
                <OriginBadge origin={rec.candidate.origin} className="h-4 px-1 text-[9px]" />
                Moment {n + 1}: TwelveLabs Marengo {rec.candidate.foundBy === "TWELVELABS" ? "search" : "metadata fallback"} · ScorePlay {rec.candidate.discoveredBy.toLowerCase().replace("_", " ")}
              </li>
            ))}
            {goal.alternatives?.candidates.map((a) => (
              <li key={a.key} className="flex flex-wrap items-center gap-2">
                <OriginBadge origin={a.hit.origin} className="h-4 px-1 text-[9px]" /> Alternative {a.key}: REROUTE resolver search
              </li>
            ))}
            <li>SIMULATED data: none. The studio uses no simulated fan or market signals (those live only on the flagged signal board).</li>
            <li>
              Library: {r.library.videos} {CLUBS[r.club].label} videos in ScorePlay, {r.library.indexed} in TwelveLabs index {r.library.indexName ?? "—"}.
              {r.matchFilter &&
                ` Match “${r.matchFilter.requested}”: ${r.matchFilter.status === "APPLIED" ? `search restricted to ${r.matchFilter.videos} videos` : "not found in metadata — library unfiltered"}.`}
            </li>
            <li>
              Search: {r.search.status}
              {r.search.code && ` [${r.search.code}]`} — {r.search.message} ({duration(goal.timing.toRecommendationsSec)})
            </li>
          </ul>
        </section>

        {goal.rights.perIntent.length > 0 && (
          <section className="space-y-3">
            <H>Evaluation reasons</H>
            {goal.rights.perIntent.map((p) => (
              <div key={`${p.channel}-${p.territory}`} className="rounded-md border border-white/8 bg-black/25 p-2">
                <p className="font-mono text-[10px] text-zinc-300">
                  {CHANNEL_LABEL[p.channel] ?? p.channel} · {p.territory} · {p.use} → {p.verdict} / {p.clearance} · policy {p.policyId}
                  {p.policyVersion && ` v${p.policyVersion}`}
                  {p.policyFictional && " (fictional)"}
                </p>
                <ul className="mt-1 space-y-0.5">
                  {p.reasons.map((x, n) => (
                    <li key={n} className="grid grid-cols-[4.5rem_1fr] gap-x-2">
                      <span className={cn("font-mono text-[10px]", OUTCOME_CLS[x.outcome])}>{x.outcome}</span>
                      <span>
                        <span className="font-mono text-[10px] text-zinc-300">
                          {x.ruleId} · {x.dimension} · basis {x.basis ?? "—"}
                          {x.start !== undefined && ` · ${clock(x.start)}–${clock(x.end ?? x.start)}`}
                        </span>{" "}
                        {x.explanation}
                      </span>
                    </li>
                  ))}
                  {p.reasons.length === 0 && <li>No reasons reported.</li>}
                </ul>
                {p.policySelection && (
                  <div className="mt-2">
                    <p className="font-mono text-[10px] text-zinc-300">
                      Policy selection → {p.policySelection.policyId ?? "none applicable"} ({p.policySelection.kind ?? "—"})
                    </p>
                    <ul className="mt-0.5 space-y-0.5">
                      {p.policySelection.considered.map((s) => (
                        <li key={s.policyId}>
                          <span className={cn("font-mono text-[10px]", s.applicable ? "text-emerald-300" : "text-zinc-500")}>
                            {s.applicable ? "applicable" : "not applicable"}
                          </span>{" "}
                          {s.policyId}: {s.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ))}
          </section>
        )}

        <section>
          <H>Media mapping (ScorePlay ↔ TwelveLabs)</H>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-0.5 pr-2 font-medium">Media</th>
                  <th className="py-0.5 pr-2 font-medium">ScorePlay id</th>
                  <th className="py-0.5 pr-2 font-medium">TwelveLabs id</th>
                  <th className="py-0.5 pr-2 font-medium">Method</th>
                  <th className="py-0.5 pr-2 font-medium">Filename</th>
                  <th className="py-0.5 font-medium">Δ duration</th>
                </tr>
              </thead>
              <tbody>
                {goal.recommendations.map((rec, n) => (
                  <MappingRow key={rec.key} label={`Moment ${n + 1}`} m={rec.media} />
                ))}
                {c && <MappingRow label={`Campaign v${c.version}`} m={c.mediaRef} />}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <H>Moment scoring</H>
          <ul className="space-y-1">
            {goal.recommendations.map((rec, n) => (
              <li key={rec.key}>
                <span className="font-mono text-[10px] text-zinc-300">
                  Moment {n + 1}: {rec.score} = ({RANKING.relevance} × {rec.breakdown.relevance} + {RANKING.readiness} × {rec.breakdown.readiness}) × {rec.breakdown.contextFactor}
                </span>{" "}
                {rec.breakdown.notes.relevance} {rec.breakdown.notes.context}
                {rec.matches.length > 0 && ` Matched: ${rec.matches.map((m) => `“${m.query}” #${m.rank}`).join(", ")}.`}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <H>Questions asked to TwelveLabs</H>
          <ul className="space-y-0.5">
            {r.intents.map((i) => (
              <li key={i.key}>
                “{i.query}” · weight <span className="font-mono">{i.weight}</span> — {i.why}
              </li>
            ))}
          </ul>
          <ul className="mt-2 space-y-0.5 font-mono text-[10px]">
            {r.attempts.map((a, n) => (
              <li key={n}>
                {a.service} “{a.query}” → {a.outcome}
                {a.code && ` [${a.code}]`}
                {a.detail && <span className="text-zinc-600"> · {a.detail}</span>}
              </li>
            ))}
          </ul>
        </section>

        <section>
          <H>Raw ids</H>
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-0.5 font-mono text-[10px]">
            <dt>goal run</dt>
            <dd className="break-all text-zinc-300">{r.id}</dd>
            {c && (
              <>
                <dt>campaign</dt>
                <dd className="break-all text-zinc-300">
                  {c.campaignId} · v{c.version} ({c.origin.toLowerCase()}) · moment {c.key}
                </dd>
              </>
            )}
            {goal.rights.evaluationId && (
              <>
                <dt>latest evaluation</dt>
                <dd className="break-all text-zinc-300">{goal.rights.evaluationId}</dd>
              </>
            )}
            {goal.alternatives && (
              <>
                <dt>alternatives</dt>
                <dd className="break-all text-zinc-300">
                  {goal.alternatives.id} (for evaluation {goal.alternatives.forEvaluationId}, blocker {goal.alternatives.blocker.scope})
                </dd>
              </>
            )}
            {goal.receiptId && (
              <>
                <dt>receipt</dt>
                <dd className="break-all text-zinc-300">{goal.receiptId}</dd>
              </>
            )}
            <dt>writeback</dt>
            <dd className="text-zinc-300">
              {goal.writeback.status}
              {goal.writeback.at && ` · ${when(goal.writeback.at)}`}
              {goal.writeback.detail && ` · ${goal.writeback.detail}`}
            </dd>
          </dl>
          {goal.evaluations.length > 0 && (
            <ol className="mt-2 space-y-0.5 font-mono text-[10px]">
              {goal.evaluations.map((e) => (
                <li key={e.id}>
                  {when(e.evaluatedAt)} · {e.kind} · v{e.campaignVersion} · {e.key} → {e.verdict}/{e.clearance} · {e.id}
                </li>
              ))}
            </ol>
          )}
        </section>

        <Link href={deskHref(goal)} className="inline-flex items-center gap-1 text-xs text-sky-300 hover:text-sky-200">
          Open this cut in the advanced rights desk <ExternalLinkIcon className="size-3" aria-hidden />
        </Link>
      </div>
    </details>
  );
}
