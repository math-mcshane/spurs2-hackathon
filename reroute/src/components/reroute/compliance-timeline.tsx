"use client";

import type { EditDecision, EditPlan, Evidence, Segment } from "@/lib/contracts";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { OriginBadge, VERDICT_STYLE, evidenceOrigin, tc, tcRange } from "./shared";

export type TimelineLane = {
  key: string;
  label: string;
  edit: EditPlan;
  decision: EditDecision | null;
  pending: boolean;
};

type Placed = { seg: Segment; index: number; at: number; dur: number };

function place(edit: EditPlan): { placed: Placed[]; total: number } {
  let at = 0;
  const placed = edit.segments.map((seg, index) => {
    const dur = Math.max(0, seg.end - seg.start);
    const p = { seg, index, at, dur };
    at += dur;
    return p;
  });
  return { placed, total: at };
}

const SOURCE_COLOR: Record<Evidence["source"], string> = {
  TWELVELABS: "bg-sky-400",
  SCOREPLAY: "bg-teal-400",
  HUMAN: "bg-violet-400",
};

function evidenceKey(e: Evidence): string {
  return `${e.scoreplayMediaId}|${e.start}|${e.end}|${e.observation}|${e.source}`;
}

/** Dark tooltip (incl. arrow) so origin/verdict badges keep their contrast. */
const TIP =
  "max-w-sm flex-col items-start gap-1 border border-white/15 bg-zinc-900 text-zinc-100 shadow-lg [&>div:last-child]:bg-zinc-900 [&>div:last-child]:fill-zinc-900";

/**
 * Timecoded compliance timeline in EDIT time: every segment of each lane coloured by its own
 * per-segment verdict, blocked ranges hatched, evidence markers mapped from source time.
 */
export function ComplianceTimeline({
  lanes,
  observations,
  playhead,
  onSeek,
}: {
  lanes: TimelineLane[];
  /** Asset-level observations keyed by ScorePlay media id (TwelveLabs + HUMAN). */
  observations: Record<string, Evidence[]>;
  playhead: { mediaId: string; t: number } | null;
  onSeek: (mediaId: string, t: number) => void;
}) {
  const layouts = lanes.map((l) => ({ lane: l, ...place(l.edit) }));
  const total = Math.max(1, ...layouts.map((l) => l.total));
  const ticks = Array.from({ length: Math.floor(total) + 1 }, (_, i) => i);
  const pct = (t: number) => `${(t / total) * 100}%`;

  return (
    <div className="space-y-2" aria-label="Compliance timeline">
      <div className="relative ml-20 h-4 select-none" aria-hidden>
        {ticks.map((t) => (
          <div key={t} className="absolute top-0 h-full" style={{ left: pct(t) }}>
            <div className={cn("w-px bg-zinc-700", t % 5 === 0 ? "h-2.5" : "h-1.5")} />
            {t % 5 === 0 && (
              <span className="absolute top-2 -translate-x-1/2 font-mono text-[9px] text-zinc-500">{t}s</span>
            )}
          </div>
        ))}
      </div>

      {layouts.map(({ lane, placed }) => {
        const segDecisions = lane.decision?.segments;
        const markers: { e: Evidence; at: number; dur: number }[] = [];
        const seen = new Set<string>();
        for (const p of placed) {
          const pool = [
            ...(segDecisions?.[p.index]?.decision.evidence ?? []),
            ...(observations[p.seg.scoreplayMediaId] ?? []),
          ];
          for (const e of pool) {
            if (e.scoreplayMediaId !== p.seg.scoreplayMediaId) continue;
            const s = e.start ?? p.seg.start;
            const en = e.end ?? p.seg.end;
            const lo = Math.max(s, p.seg.start);
            const hi = Math.min(en, p.seg.end);
            if (hi < lo || (hi === lo && en !== s)) continue;
            const k = `${p.index}|${evidenceKey(e)}`;
            if (seen.has(k)) continue;
            seen.add(k);
            markers.push({ e, at: p.at + (lo - p.seg.start), dur: hi - lo });
          }
        }

        return (
          <div key={lane.key} className="flex items-stretch gap-2">
            <div className="flex w-18 shrink-0 flex-col justify-center">
              <span className="font-mono text-[10px] tracking-widest text-zinc-400">{lane.label}</span>
              {lane.decision && (
                <span className={cn("font-mono text-[9px]", VERDICT_STYLE[lane.decision.decision.verdict].text)}>
                  {VERDICT_STYLE[lane.decision.decision.verdict].label}
                </span>
              )}
              {lane.pending && <span className="font-mono text-[9px] text-zinc-500">checking…</span>}
            </div>
            <div className="relative min-w-0 flex-1">
              <div className="relative h-11 overflow-hidden rounded border border-white/10 bg-zinc-950">
                {placed.map((p) => {
                  const d = segDecisions?.[p.index]?.decision;
                  const style = d ? VERDICT_STYLE[d.verdict] : null;
                  const firstDeny = d?.reasons.find((r) => r.outcome === "DENY");
                  return (
                    <Tooltip key={p.index}>
                      <TooltipTrigger
                        type="button"
                        onClick={() => onSeek(p.seg.scoreplayMediaId, p.seg.start)}
                        aria-label={`Segment ${p.index + 1}, ${tcRange(p.seg.start, p.seg.end)} of ${p.seg.scoreplayMediaId}: ${d ? style!.label : "not yet decided"}. Click to seek.`}
                        className={cn(
                          "absolute inset-y-0 flex flex-col justify-between overflow-hidden border-r border-zinc-950 px-1.5 py-1 text-left transition-opacity hover:opacity-90 focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none",
                          style ? style.fill : "bg-zinc-700/60",
                          d?.verdict === "BLOCKED" &&
                            "bg-[repeating-linear-gradient(135deg,rgba(0,0,0,0.25)_0_6px,transparent_6px_12px)] ring-2 ring-red-400 ring-inset",
                          lane.pending && "animate-pulse",
                        )}
                        style={{ left: pct(p.at), width: pct(p.dur) }}
                      >
                        <span className="truncate font-mono text-[10px] font-semibold text-white drop-shadow">
                          #{p.index + 1} {d ? style!.label : "…"}
                        </span>
                        <span className="truncate font-mono text-[9px] text-white/80">
                          {tcRange(p.seg.start, p.seg.end)}
                          {p.seg.label ? ` · ${p.seg.label}` : ""}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className={TIP}>
                        <span className="font-mono">
                          #{p.index + 1} · {p.seg.scoreplayMediaId} · {tcRange(p.seg.start, p.seg.end)}
                        </span>
                        <span>{d ? `Verdict: ${style!.label}` : "Not yet decided"}</span>
                        {firstDeny && (
                          <span>
                            {firstDeny.ruleId} ({firstDeny.dimension}): {firstDeny.explanation}
                          </span>
                        )}
                      </TooltipContent>
                    </Tooltip>
                  );
                })}
                {playhead &&
                  placed
                    .filter(
                      (p) =>
                        p.seg.scoreplayMediaId === playhead.mediaId &&
                        playhead.t >= p.seg.start &&
                        playhead.t <= p.seg.end,
                    )
                    .map((p) => (
                      <div
                        key={`ph-${p.index}`}
                        aria-hidden
                        className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow-[0_0_6px] shadow-white"
                        style={{ left: pct(p.at + (playhead.t - p.seg.start)) }}
                      />
                    ))}
              </div>
              <div className="relative mt-1 h-3">
                {markers.map(({ e, at, dur }, i) => (
                  <Tooltip key={i}>
                    <TooltipTrigger
                      type="button"
                      onClick={() => onSeek(e.scoreplayMediaId, e.start ?? 0)}
                      aria-label={`Evidence: ${e.observation} (${e.source}, ${tcRange(e.start, e.end)}). Click to seek.`}
                      className={cn(
                        "absolute top-0 h-2.5 min-w-1.5 rounded-sm opacity-90 hover:opacity-100 focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:outline-none",
                        SOURCE_COLOR[e.source],
                      )}
                      style={{ left: pct(at), width: pct(dur) }}
                    />
                    <TooltipContent className={TIP}>
                      <span className="font-medium">{e.observation}</span>
                      <span className="flex items-center gap-1.5 font-mono text-[10px]">
                        {e.source} <OriginBadge origin={evidenceOrigin(e)} className="h-4 px-1 text-[9px]" />
                      </span>
                      <span className="font-mono text-[10px]">
                        {e.scoreplayMediaId} · {tcRange(e.start, e.end)}
                      </span>
                      {e.label && <span className="font-mono text-[10px]">label: {e.label}</span>}
                      {e.confidence !== undefined && (
                        <span className="text-[10px]">Observation confidence: {Math.round(e.confidence * 100)}%</span>
                      )}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      <div className="ml-20 flex flex-wrap gap-3 font-mono text-[9px] text-zinc-500">
        <Legend className={VERDICT_STYLE.ALLOWED.fill}>allowed</Legend>
        <Legend className={VERDICT_STYLE.BLOCKED.fill}>blocked</Legend>
        <Legend className={VERDICT_STYLE.NEEDS_REVIEW.fill}>needs review</Legend>
        <Legend className={SOURCE_COLOR.TWELVELABS}>TwelveLabs evidence</Legend>
        <Legend className={SOURCE_COLOR.SCOREPLAY}>ScorePlay evidence</Legend>
        <Legend className={SOURCE_COLOR.HUMAN}>human evidence</Legend>
        <span>edit length {tc(total)}</span>
      </div>
    </div>
  );
}

function Legend({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cn("inline-block size-2 rounded-sm", className)} aria-hidden />
      {children}
    </span>
  );
}
