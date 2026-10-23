"use client";

import { useCallback, useEffect, useState } from "react";
import { DatabaseIcon, Loader2Icon, LogInIcon, RefreshCwIcon, ShieldOffIcon, TriangleAlertIcon } from "lucide-react";
import { DEMO_CLEARANCE_LABEL, type RightsReceipt } from "@/lib/contracts";
import type { WritebackPreview } from "@/lib/scoreplay/writeback";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { reviewApi, type ReviewerSession, type WritebackView } from "./reviewer";
import { ErrorState, utc } from "./shared";

const STATUS_CLS: Record<RightsReceipt["writeback"][number]["status"], string> = {
  VERIFIED: "text-status-clear",
  WRITTEN: "text-ink",
  DRY_RUN: "text-ink-soft",
  REFUSED: "text-status-review",
  FAILED: "text-status-blocked",
};

type Plan = Pick<WritebackPreview, "mode" | "planned" | "refusedReason"> & { readBack?: WritebackView["readBack"] };

/** Exactly what would be (DRY_RUN) or was (LIVE) sent to ScorePlay, and why live writing was refused. */
export function WritebackPlan({ result }: { result: Plan }) {
  return (
    <div className="space-y-3 text-small">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-ink-muted">
        <span className={cn("font-medium", result.mode === "LIVE" ? "text-ink" : "text-ink-soft")}>
          {result.mode === "DRY_RUN" ? "Dry run — nothing is written to ScorePlay" : "Live — writes to ScorePlay"}
        </span>
        <span aria-hidden>·</span>
        <span>
          {result.planned.length} planned ScorePlay call{result.planned.length === 1 ? "" : "s"}
        </span>
      </p>
      {result.refusedReason && (
        <p role="note" className="flex items-start gap-2 text-ink-soft">
          <ShieldOffIcon className="mt-0.5 size-3.5 shrink-0 text-status-review" aria-hidden />
          <span>
            <span className="text-ink">Live write refused.</span> {result.refusedReason.replaceAll(DEMO_CLEARANCE_LABEL, "Demo policy — not verified legal clearance")}
          </span>
        </p>
      )}
      {result.planned.length === 0 ? (
        <p className="text-ink-muted">No ScorePlay call is planned for this receipt.</p>
      ) : (
        <ol className="space-y-2">
          {result.planned.map((a, i) => (
            <li key={i} className="min-w-0 rounded-lg bg-obsidian p-3 ring-1 ring-line ring-inset">
              <div className="flex flex-wrap items-center gap-2 font-mono text-meta">
                <DatabaseIcon className="size-3.5 text-ink-muted" aria-hidden />
                <span className="text-ink">{a.method}</span>
                <span className="break-all text-ink-soft">{a.path}</span>
              </div>
              <p className="mt-1.5 text-ink-soft">{a.purpose}</p>
              {a.body !== undefined && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-surface p-2 font-mono text-[0.6875rem] text-ink-muted">{JSON.stringify(a.body, null, 2)}</pre>
              )}
            </li>
          ))}
        </ol>
      )}
      {result.readBack && (
        <details className="text-meta text-ink-muted">
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

  if (session?.enabled === false) return <p className="text-small text-ink-muted">Reviewer sign-in is not configured, so writeback is unavailable.</p>;
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
      <p className="flex items-center gap-2 text-small text-ink-muted">
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
  if (latest.length === 0) return <p className="text-meta text-ink-muted">No writeback attempt yet.</p>;
  return (
    <ul className="space-y-1 text-meta">
      {latest.map((w) => (
        <li key={w.scoreplayMediaId} className="flex flex-wrap items-center gap-2">
          <span className={cn("font-medium", STATUS_CLS[w.status])}>{w.status.replace("_", " ").toLowerCase()}</span>
          <span className="text-ink-soft">{w.scoreplayMediaId}</span>
          <span className="text-ink-muted">{utc(w.at)}</span>
          {w.detail && <span className="break-words text-ink-muted">{w.detail.replaceAll(DEMO_CLEARANCE_LABEL, "Demo policy — not verified legal clearance")}</span>}
        </li>
      ))}
    </ul>
  );
}
