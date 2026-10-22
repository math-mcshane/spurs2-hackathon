"use client";

import { useCallback, useEffect, useState } from "react";
import { DatabaseIcon, FileCheck2Icon, Loader2Icon, LogInIcon, RefreshCwIcon } from "lucide-react";
import type { MediaRef } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { ErrorState, tcRange } from "@/components/reroute/shared";
import { reviewApi, type AuditedReceipt, type ReviewerSession, type WritebackView } from "@/components/reroute/reviewer";
import { WritebackLog, WritebackPlan } from "@/components/reroute/writeback-plan";
import { describeError } from "@/lib/api-client";
import { when } from "../pulse-ui";
import { CHANNEL_LABEL, DemoPolicyBadge, RightsPill } from "./parts";

const METHOD_TEXT: Record<MediaRef["method"], string> = {
  AUTHORITATIVE_ID: "linked by ScorePlay id",
  FILENAME_DURATION: "linked by exact filename + duration",
  AMBIGUOUS: "ambiguous link — evidence not attached",
  UNMAPPED: "no TwelveLabs match — evidence not attached",
};

/** Step 10: the audit receipt and the ScorePlay writeback plan. Reloads whenever review or writeback state changes. */
export function ReceiptView({
  receiptId,
  version,
  session,
  onSignIn,
  onWriteback,
}: {
  receiptId: string;
  /** Changes whenever the receipt changed server-side (review, writeback): triggers a reload. */
  version: string;
  session: ReviewerSession | null;
  onSignIn: () => void;
  onWriteback: () => void;
}) {
  const [receipt, setReceipt] = useState<AuditedReceipt | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [plan, setPlan] = useState<WritebackView | null>(null);
  const [planBusy, setPlanBusy] = useState(false);
  const [planError, setPlanError] = useState<unknown>(null);

  const load = useCallback(() => {
    reviewApi.receipt(receiptId).then((r) => {
      setReceipt(r);
      setError(null);
    }, setError);
  }, [receiptId]);
  useEffect(load, [load, version]);

  async function writeback() {
    setPlanBusy(true);
    setPlanError(null);
    try {
      const r = await reviewApi.writeback(receiptId);
      setPlan(r);
      setReceipt((prev) => (prev ? { ...prev, ...r.receipt, audit: prev.audit } : prev));
      onWriteback();
    } catch (err) {
      setPlanError(err);
    } finally {
      setPlanBusy(false);
    }
  }

  if (error !== null && !receipt) {
    return (
      <div className="space-y-2">
        <ErrorState error={error} />
        <Button size="sm" variant="outline" onClick={load}>
          <RefreshCwIcon /> Retry
        </Button>
      </div>
    );
  }
  if (!receipt) {
    return (
      <p className="flex items-center gap-2 text-sm text-zinc-400">
        <Loader2Icon className="size-4 animate-spin" aria-hidden /> Loading the audit receipt…
      </p>
    );
  }

  const d = receipt.decision;
  const i = receipt.intent;
  const signedOut = session?.enabled && !session.reviewer;
  const forbidden = planError !== null && describeError(planError).code === "FORBIDDEN";
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <article aria-label={`Audit receipt ${receipt.id}`} className="space-y-3 rounded-xl border border-white/10 bg-zinc-950/70 p-4 text-xs">
        <header className="flex flex-wrap items-center gap-2">
          <FileCheck2Icon className="size-4 text-zinc-300" aria-hidden />
          <h3 className="text-sm font-semibold text-zinc-50">Audit receipt</h3>
          <span className="font-mono text-[11px] text-zinc-400">#{receipt.id}</span>
          <RightsPill state={d.verdict} clearance={d.clearance} />
        </header>
        {d.policyFictional && <DemoPolicyBadge />}
        <dl className="grid grid-cols-[minmax(6.5rem,auto)_1fr] gap-x-3 gap-y-1.5">
          <dt className="text-zinc-500">Decision</dt>
          <dd className="text-zinc-100">
            {d.verdict} · clearance {d.clearance}
          </dd>
          <dt className="text-zinc-500">Policy</dt>
          <dd className="text-zinc-100">
            {d.policyId} v{d.policyVersion} · {d.policySelection?.kind ?? (d.policyFictional ? "DEMO" : "VERIFIED")}
            {d.policyFictional && <span className="text-amber-300"> (fictional demo policy)</span>}
          </dd>
          <dt className="text-zinc-500">Use checked</dt>
          <dd className="text-zinc-100">
            {CHANNEL_LABEL[i.platform] ?? i.platform} · {i.territory} · {i.usage} · {i.competition}
          </dd>
          <dt className="text-zinc-500">Media</dt>
          <dd className="space-y-1">
            {receipt.edit.segments.map((s, n) => (
              <span key={n} className="block font-mono text-[11px] text-zinc-200">
                ScorePlay {s.scoreplayMediaId} · {tcRange(s.start, s.end)}
              </span>
            ))}
            {receipt.media.map((m, n) => (
              <span key={`m${n}`} className="block text-[11px] text-zinc-400">
                {m.scoreplayMediaId ?? "—"} ↔ TwelveLabs {m.twelvelabsVideoId ?? "—"} · {METHOD_TEXT[m.method]}
                {m.match?.durationDeltaSec !== undefined && ` (Δ ${m.match.durationDeltaSec.toFixed(3)} s)`}
              </span>
            ))}
          </dd>
          {receipt.campaignId && (
            <>
              <dt className="text-zinc-500">Campaign</dt>
              <dd className="font-mono text-[11px] text-zinc-300">{receipt.campaignId}</dd>
            </>
          )}
          <dt className="text-zinc-500">Review</dt>
          <dd className="text-zinc-100">
            {receipt.humanReviewStatus}
            {receipt.reviews.map((r, n) => (
              <span key={n} className="block text-[11px] text-zinc-400">
                {r.status} by {r.reviewer} · {when(r.at)}
              </span>
            ))}
          </dd>
          <dt className="text-zinc-500">Created</dt>
          <dd className="text-zinc-300">{when(receipt.createdAt)}</dd>
          <dt className="text-zinc-500">Decided</dt>
          <dd className="text-zinc-300">{when(d.evaluatedAt)}</dd>
        </dl>
        {receipt.audit.length > 0 && (
          <details className="text-[11px] text-zinc-400">
            <summary className="cursor-pointer hover:text-zinc-200">Audit trail · {receipt.audit.length} hash-chained events</summary>
            <ol className="mt-1 space-y-0.5 font-mono text-[10px]">
              {receipt.audit.map((e) => (
                <li key={e.id}>
                  {when(e.at)} · {e.type} · {e.actor} · <span className="text-zinc-600">{e.hash.slice(0, 12)}</span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </article>

      <section aria-label="ScorePlay writeback" className="space-y-3 rounded-xl border border-white/10 bg-zinc-950/60 p-4 text-xs">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-zinc-50">
          <DatabaseIcon className="size-4 text-zinc-300" aria-hidden /> ScorePlay writeback
        </h3>
        <p className="text-zinc-400">See exactly what would be written back to ScorePlay for this receipt. This server runs in dry-run mode, so nothing is written.</p>
        <div className="flex flex-wrap gap-2">
          {signedOut ? (
            <Button variant="outline" onClick={onSignIn}>
              <LogInIcon /> Sign in as reviewer to preview
            </Button>
          ) : (
            <Button variant="outline" disabled={planBusy} onClick={() => void writeback()}>
              {planBusy ? <Loader2Icon className="animate-spin" /> : <DatabaseIcon />} {plan ? "Run the dry run again" : "Preview writeback (dry run)"}
            </Button>
          )}
        </div>
        {planError !== null && (
          <>
            <ErrorState error={planError} service="ScorePlay" />
            {forbidden && (
              <Button size="sm" variant="outline" onClick={onSignIn}>
                <LogInIcon /> Sign in as reviewer
              </Button>
            )}
          </>
        )}
        {plan && <WritebackPlan result={plan} />}
        <div className="space-y-1 border-t border-white/5 pt-2">
          <h4 className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Attempts on this receipt</h4>
          <WritebackLog entries={receipt.writeback} />
        </div>
      </section>
    </div>
  );
}
