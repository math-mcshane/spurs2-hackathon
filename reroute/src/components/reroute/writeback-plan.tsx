"use client";

import { useCallback, useEffect, useState } from "react";
import { DatabaseIcon, Loader2Icon, LogInIcon, RefreshCwIcon, ShieldOffIcon, TriangleAlertIcon } from "lucide-react";
import type { RightsReceipt } from "@/lib/contracts";
import type { WritebackPreview } from "@/lib/scoreplay/writeback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { reviewApi, type ReviewerSession, type WritebackView } from "./reviewer";
import { ErrorState, utc } from "./shared";

const STATUS_CLS: Record<RightsReceipt["writeback"][number]["status"], string> = {
  VERIFIED: "border-emerald-500/50 text-emerald-300",
  WRITTEN: "border-sky-500/50 text-sky-300",
  DRY_RUN: "border-zinc-500/60 text-zinc-300",
  REFUSED: "border-amber-500/50 text-amber-300",
  FAILED: "border-red-500/50 text-red-300",
};

type Plan = Pick<WritebackPreview, "mode" | "planned" | "refusedReason"> & { readBack?: WritebackView["readBack"] };

/** Exactly what would be (DRY_RUN) or was (LIVE) sent to ScorePlay, and why live writing was refused. */
export function WritebackPlan({ result }: { result: Plan }) {
  return (
    <div className="space-y-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            "rounded-sm border px-1.5 py-px font-mono text-[10px] tracking-wider",
            result.mode === "LIVE" ? "border-sky-500/50 text-sky-300" : "border-zinc-500/60 text-zinc-200",
          )}
        >
          {result.mode === "DRY_RUN" ? "DRY RUN — nothing is written to ScorePlay" : "LIVE — writes to ScorePlay"}
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
            <li key={i} className="min-w-0 rounded-md border border-white/8 bg-black/30 p-2">
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

/**
 * Reviewer-only writeback control. Asks the server what a writeback would do (`GET /api/writeback`, no side
 * effects) and labels the action accordingly; a LIVE write needs an explicit confirmation naming the media.
 */
export function WritebackAction({
  receiptId,
  session,
  onSignIn,
  onDone,
}: {
  receiptId: string;
  session: ReviewerSession | null;
  onSignIn: () => void;
  onDone: (r: WritebackView) => void;
}) {
  const signedIn = !!session?.reviewer;
  const [preview, setPreview] = useState<WritebackPreview | null>(null);
  const [previewError, setPreviewError] = useState<unknown>(null);
  const [result, setResult] = useState<WritebackView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);

  const loadPreview = useCallback(() => {
    reviewApi.writebackPreview(receiptId).then(
      (p) => {
        setPreview(p);
        setPreviewError(null);
      },
      setPreviewError,
    );
  }, [receiptId]);
  useEffect(() => {
    if (signedIn) loadPreview();
  }, [signedIn, loadPreview]);

  async function write() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    try {
      const r = await reviewApi.writeback(receiptId);
      setResult(r);
      onDone(r);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  if (session?.enabled === false) return <p className="text-[11px] text-zinc-500">Reviewer sign-in is not configured, so writeback is unavailable.</p>;
  if (!signedIn)
    return (
      <Button variant="outline" size="sm" onClick={onSignIn} disabled={!session}>
        <LogInIcon /> Sign in as reviewer to see the writeback
      </Button>
    );
  if (previewError !== null && !preview)
    return (
      <div className="space-y-2">
        <ErrorState error={previewError} service="ScorePlay" />
        <Button size="sm" variant="outline" onClick={loadPreview}>
          <RefreshCwIcon /> Retry
        </Button>
      </div>
    );
  if (!preview)
    return (
      <p className="flex items-center gap-2 text-[11px] text-zinc-400">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Asking what a writeback would do…
      </p>
    );

  const live = preview.mode === "LIVE";
  return (
    <div className="space-y-3">
      <Button variant={live ? "default" : "outline"} size="sm" disabled={busy} onClick={() => (live ? setConfirming(true) : void write())}>
        {busy ? <Loader2Icon className="animate-spin" /> : <DatabaseIcon />}
        {live ? "Write to ScorePlay…" : result ? "Run the dry run again" : "Preview writeback (dry run)"}
      </Button>
      {error !== null && <ErrorState error={error} service="ScorePlay" />}
      <WritebackPlan result={result ?? preview} />
      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <TriangleAlertIcon className="size-4 text-amber-400" aria-hidden /> Write to ScorePlay?
            </DialogTitle>
            <DialogDescription>
              This is a LIVE write. {preview.planned.length} call{preview.planned.length === 1 ? "" : "s"} will change ScorePlay media:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 font-mono text-xs">
            {preview.targets.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button onClick={() => void write()}>Write to {preview.targets.length} media</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
          <span className="text-zinc-500">{utc(w.at)}</span>
          {w.detail && <span className="break-words text-zinc-400">{w.detail}</span>}
        </li>
      ))}
    </ul>
  );
}
