"use client";

import { FilmIcon, Loader2Icon, RouteIcon, Undo2Icon } from "lucide-react";
import type { Candidate, ResolveResponseSchema } from "@/lib/contracts";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ErrorState, OriginBadge, VerdictBadge, tcRange } from "./shared";

export type ResolveResult = z.infer<typeof ResolveResponseSchema>;
export type ResolveState =
  | { status: "idle" }
  | { status: "loading"; segmentIndex: number }
  | { status: "done"; segmentIndex: number; res: ResolveResult }
  | { status: "error"; error: unknown };

export function ResolvePanel({
  blockedIndex,
  state,
  appliedEditId,
  onResolve,
  onApply,
  onRevert,
}: {
  /** Index of the first BLOCKED segment of the active edit, or null when nothing is blocked. */
  blockedIndex: number | null;
  state: ResolveState;
  appliedEditId: string | null;
  onResolve: (segmentIndex: number) => void;
  onApply: (c: Candidate) => void;
  onRevert: () => void;
}) {
  return (
    <div className="space-y-2 p-3">
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => blockedIndex !== null && onResolve(blockedIndex)}
          disabled={blockedIndex === null || state.status === "loading"}
          className="bg-sky-500 text-sky-950 hover:bg-sky-400"
        >
          {state.status === "loading" ? <Loader2Icon className="animate-spin" /> : <RouteIcon />}
          Find compliant path
        </Button>
        <span className="text-[11px] text-zinc-400">
          {blockedIndex === null
            ? "Available when a segment is BLOCKED."
            : `Replace segment #${blockedIndex + 1} via Marengo search; every candidate is re-checked.`}
        </span>
        {appliedEditId && (
          <Button type="button" size="xs" variant="ghost" className="ml-auto text-zinc-400" onClick={onRevert}>
            <Undo2Icon /> Back to original
          </Button>
        )}
      </div>

      {state.status === "error" && <ErrorState error={state.error} service="TwelveLabs" />}

      {state.status === "done" && (
        <>
          <p className="font-mono text-[10px] text-zinc-500">
            query: “{state.res.query}” · {state.res.candidates.length} candidate
            {state.res.candidates.length === 1 ? "" : "s"} for segment #{state.segmentIndex + 1}
            {!state.res.best && " · no eligible alternative — the original stays restricted"}
          </p>
          {state.res.candidates.length === 0 && (
            <p className="text-xs text-zinc-500">Marengo returned no comparable segments in the indexed footage.</p>
          )}
          <ul className="grid gap-2 sm:grid-cols-3">
            {state.res.candidates.slice(0, 3).map((c) => (
              <CandidateCard
                key={`${c.hit.scoreplayMediaId}-${c.hit.start}-${c.hit.rank}`}
                c={c}
                best={state.res.best?.proposedEdit.id === c.proposedEdit.id}
                applied={appliedEditId === c.proposedEdit.id}
                onApply={() => onApply(c)}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function CandidateCard({ c, best, applied, onApply }: { c: Candidate; best: boolean; applied: boolean; onApply: () => void }) {
  return (
    <li
      className={cn(
        "flex flex-col overflow-hidden rounded-md border bg-zinc-950",
        applied ? "border-sky-400/70" : c.eligible ? "border-emerald-500/40" : "border-white/10",
      )}
    >
      <div className="relative flex aspect-video items-center justify-center bg-zinc-800">
        {c.hit.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- remote TwelveLabs/ScorePlay thumbnail
          <img src={c.hit.thumbnailUrl} alt={`Candidate from ${c.hit.scoreplayMediaId}`} className="size-full object-cover" />
        ) : (
          <FilmIcon className="size-5 text-zinc-600" aria-hidden />
        )}
        <span className="absolute top-1 left-1 rounded bg-black/75 px-1 font-mono text-[10px] text-zinc-100">
          Marengo #{c.hit.rank}
          {c.hit.score !== undefined && <span className="text-zinc-400"> · {c.hit.score.toFixed(2)}</span>}
        </span>
        <OriginBadge origin={c.hit.origin} className="absolute top-1 right-1 h-4 bg-black/70 px-1 text-[9px]" />
        {best && (
          <span className="absolute bottom-1 left-1 rounded bg-emerald-500 px-1 font-mono text-[9px] font-bold text-emerald-950">
            BEST ELIGIBLE
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1.5 p-2">
        <div className="font-mono text-[10px] text-zinc-300">
          <div className="truncate" title={c.hit.scoreplayMediaId}>ScorePlay {c.hit.scoreplayMediaId}</div>
          <div className="text-zinc-500">{tcRange(c.hit.start, c.hit.end)}</div>
        </div>
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-2 gap-y-1 text-[10px] text-zinc-500">
          <dt>Segment</dt>
          <dd><VerdictBadge verdict={c.segmentDecision.verdict} className="h-4 px-1 text-[9px]" /></dd>
          <dt>Full edit</dt>
          <dd><VerdictBadge verdict={c.editDecision.decision.verdict} className="h-4 px-1 text-[9px]" /></dd>
        </dl>
        <Badge
          variant="outline"
          className={cn(
            "rounded-sm font-mono text-[9px]",
            c.eligible ? "border-emerald-500/50 text-emerald-300" : "border-zinc-600 text-zinc-400",
          )}
        >
          {c.eligible ? "ELIGIBLE" : "NOT ELIGIBLE"}
        </Badge>
        {!c.eligible && (
          <p className="text-[10px] text-zinc-500">
            {c.editDecision.decision.reasons.find((r) => r.outcome !== "PERMIT")?.explanation ??
              "Full edit is not ALLOWED for this intent."}
          </p>
        )}
        <Button
          type="button"
          size="xs"
          variant={applied ? "secondary" : "outline"}
          className="mt-auto"
          disabled={!c.eligible || applied}
          onClick={onApply}
        >
          {applied ? "In proposed edit" : "Use this alternative"}
        </Button>
      </div>
    </li>
  );
}
