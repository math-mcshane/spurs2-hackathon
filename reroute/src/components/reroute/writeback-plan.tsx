"use client";

import { DatabaseIcon, ShieldOffIcon } from "lucide-react";
import type { RightsReceipt } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import type { WritebackView } from "./reviewer";

const STATUS_CLS: Record<RightsReceipt["writeback"][number]["status"], string> = {
  VERIFIED: "border-emerald-500/50 text-emerald-300",
  WRITTEN: "border-sky-500/50 text-sky-300",
  DRY_RUN: "border-zinc-500/60 text-zinc-300",
  REFUSED: "border-amber-500/50 text-amber-300",
  FAILED: "border-red-500/50 text-red-300",
};

/** Exactly what would be (DRY_RUN) or was (LIVE) sent to ScorePlay, and why live writing was refused. */
export function WritebackPlan({ result }: { result: WritebackView }) {
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-sm border px-1.5 py-px font-mono text-[10px] tracking-wider",
            result.mode === "LIVE" ? "border-sky-500/50 text-sky-300" : "border-zinc-500/60 text-zinc-200",
          )}
        >
          {result.mode === "DRY_RUN" ? "DRY RUN — nothing written to ScorePlay" : "LIVE"}
        </span>
        <span className="text-zinc-400">
          {result.planned.length} planned ScorePlay call{result.planned.length === 1 ? "" : "s"}
        </span>
      </div>
      {result.refusedReason && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-100">
          <ShieldOffIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            <strong>Live write refused:</strong> {result.refusedReason}
          </span>
        </p>
      )}
      {result.planned.length === 0 ? (
        <p className="text-zinc-500">No ScorePlay call is planned for this receipt.</p>
      ) : (
        <ol className="space-y-2">
          {result.planned.map((a, i) => (
            <li key={i} className="rounded-md border border-white/8 bg-black/30 p-2">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
                <DatabaseIcon className="size-3.5 text-zinc-400" aria-hidden />
                <span className="text-sky-300">{a.method}</span>
                <span className="break-all text-zinc-200">{a.path}</span>
              </div>
              <p className="mt-1 text-zinc-300">{a.purpose}</p>
              {a.body !== undefined && (
                <pre className="mt-1 max-h-40 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px] text-zinc-400">{JSON.stringify(a.body, null, 2)}</pre>
              )}
            </li>
          ))}
        </ol>
      )}
      {result.readBack && (
        <details className="text-[11px] text-zinc-400">
          <summary className="cursor-pointer">Read back from ScorePlay (persistence proof)</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded bg-zinc-950 p-2 font-mono text-[10px]">{JSON.stringify(result.readBack, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

/** Latest writeback attempt per media (the receipt keeps every attempt). */
export function WritebackLog({ entries }: { entries: RightsReceipt["writeback"] }) {
  const latest = [...new Map(entries.map((w) => [w.scoreplayMediaId, w])).values()];
  if (latest.length === 0) return <p className="text-[11px] text-zinc-500">No writeback attempt yet.</p>;
  return (
    <ul className="space-y-0.5 font-mono text-[10px]">
      {latest.map((w) => (
        <li key={w.scoreplayMediaId} className="flex flex-wrap items-center gap-2">
          <span className={cn("rounded-sm border px-1 tracking-wider", STATUS_CLS[w.status])}>{w.status}</span>
          <span className="text-zinc-300">{w.scoreplayMediaId}</span>
          <span className="text-zinc-500">{new Date(w.at).toLocaleString()}</span>
          {w.detail && <span className="text-zinc-400">{w.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
