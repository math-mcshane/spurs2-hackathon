"use client";

import Link from "next/link";
import { ExternalLinkIcon, WrenchIcon } from "lucide-react";
import type { MediaRef, Reason } from "@/lib/contracts";
import { OriginBadge } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import { CLUBS } from "../clubs";
import { RANKING, clock } from "../moment-ranking";
import { utc } from "@/components/reroute/shared";
import type { GoalView } from "../types";
import { CHANNEL_LABEL, duration } from "./parts";

const OUTCOME_CLS: Record<Reason["outcome"], string> = { DENY: "text-status-blocked", MISSING: "text-status-review", PERMIT: "text-status-clear" };

function H({ children }: { children: React.ReactNode }) {
  return <h4 className="mb-2 text-eyebrow font-medium text-ink-muted uppercase">{children}</h4>;
}

/** `/desk` deep link for the current cut and first checked use. */
export function deskHref(goal: GoalView): string {
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
    <li className="min-w-0 border-t border-white/5 py-1 break-all first:border-t-0">
      <span className="font-sans text-zinc-300">{label}:</span> ScorePlay {m.scoreplayMediaId ?? "—"} ↔ TwelveLabs {m.twelvelabsVideoId ?? "—"} ·{" "}
      <span className={m.method === "AMBIGUOUS" || m.method === "UNMAPPED" ? "text-amber-300" : "text-zinc-300"}>{m.method}</span> ·{" "}
      {m.match?.scoreplayFilename ?? m.match?.twelvelabsFilename ?? "no filename"} · Δ{" "}
      {m.match?.durationDeltaSec !== undefined ? `${m.match.durationDeltaSec.toFixed(3)} s` : "—"}
      {m.candidates.length > 0 && <span className="block text-amber-300/80">{m.candidates.length} competing candidates</span>}
    </li>
  );
}

/** Technical detail for judges and engineers. Collapsed by default; nothing here is needed to use the product. */
export function Diagnostics({ goal }: { goal: GoalView }) {
  const r = goal.run;
  const c = goal.campaign;
  return (
    <details className="group min-w-0 rounded-xl text-meta break-words text-ink-muted ring-1 ring-line ring-inset">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-6 py-4 text-small text-ink-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <WrenchIcon className="size-3.5" aria-hidden /> Technical details
      </summary>
      <div className="space-y-6 border-t border-line px-6 py-6">
        <section>
          <H>Data provenance</H>
          <ul className="space-y-1">
            {goal.recommendations.map((rec, n) => (
              <li key={rec.key} className="flex flex-wrap items-center gap-2">
                <OriginBadge origin={rec.candidate.origin} className="h-4 px-1 text-[9px]" />
                Moment {n + 1}: TwelveLabs Marengo {rec.candidate.foundBy === "TWELVELABS" ? "search" : "metadata fallback"} · ScorePlay {rec.candidate.discoveredBy.toLowerCase().replace("_", " ")}
              </li>
            ))}
            {goal.recovery?.options.flatMap((o) =>
              o.replacement ? (
                <li key={o.id}>
                  Recovery replacement {o.replacement.scoreplayMediaId} @ {o.replacement.start.toFixed(2)}–{o.replacement.end.toFixed(2)} s: TwelveLabs search rank {o.replacement.rank} for “
                  {o.replacement.query}”
                </li>
              ) : (
                []
              ),
            )}
            {goal.policy && (
              <li>
                Rules: {goal.policy.packageId} v{goal.policy.version} · {goal.policy.kind} · {goal.policy.sourceType} · verified {String(goal.policy.verified)}
              </li>
            )}
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
            <li>
              Timing (server-measured from goal submission): moments in {duration(goal.timing.toRecommendationsSec)}
              {goal.timing.toProposalSec !== undefined && `, first campaign draft in ${duration(goal.timing.toProposalSec)}`}. No manual baseline is assumed, so
              no time saving is claimed.
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
                    <li key={n} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2">
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
          <ul className="font-mono text-[10px]">
            {goal.recommendations.map((rec, n) => (
              <MappingRow key={rec.key} label={`Moment ${n + 1}`} m={rec.media} />
            ))}
            {c && <MappingRow label={`Campaign v${c.version}`} m={c.mediaRef} />}
          </ul>
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
          <dl className="grid grid-cols-[minmax(5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[10px]">
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
            {goal.recovery && (
              <>
                <dt>recovery</dt>
                <dd className="break-all text-zinc-300">
                  {goal.recovery.id} (for evaluation {goal.recovery.forEvaluationId}, scope {goal.recovery.scope}) ·{" "}
                  {goal.recovery.options.map((o) => `${o.kind}→${o.outcome}${o.recommended ? "*" : ""}`).join(", ")}
                </dd>
              </>
            )}
            {goal.edit && (
              <>
                <dt>edit plan</dt>
                <dd className="break-all text-zinc-300">
                  {goal.edit.edlId} · keeps {goal.edit.retained.map((r) => `${r.start.toFixed(2)}–${r.end.toFixed(2)}`).join(", ")} · {goal.edit.execution}
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
              {goal.writeback.at && ` · ${utc(goal.writeback.at)}`}
              {goal.writeback.detail && ` · ${goal.writeback.detail}`}
            </dd>
          </dl>
          {goal.evaluations.length > 0 && (
            <ol className="mt-2 space-y-0.5 font-mono text-[10px]">
              {goal.evaluations.map((e) => (
                <li key={e.id}>
                  {utc(e.evaluatedAt)} · {e.kind} · v{e.campaignVersion} · {e.key} → {e.verdict}/{e.clearance} · {e.id}
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
