"use client";

import { useState } from "react";
import { CheckIcon, ClapperboardIcon, FileCheck2Icon, Loader2Icon, LogInIcon, XIcon } from "lucide-react";
import type { EditPlan, PublishIntent } from "@/lib/contracts";
import type { ReceiptView } from "@/lib/api-client";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { reviewApi, type ReviewerSession } from "./reviewer";
import { ErrorState, FictionalTag, VerdictBadge, tcRange, utc } from "./shared";
import { WritebackAction, WritebackLog } from "./writeback-plan";

const REVIEW_STYLE: Record<ReceiptView["humanReviewStatus"], string> = {
  PENDING: "border-amber-500/50 bg-amber-500/10 text-amber-200",
  APPROVED: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200",
  REJECTED: "border-red-500/50 bg-red-500/10 text-red-200",
};

function ReceiptSummary({ receipt, title }: { receipt: ReceiptView; title: string }) {
  const d = receipt.decision;
  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-zinc-950/70 p-2.5 font-mono text-[10px] text-zinc-400">
      <div className="flex flex-wrap items-center gap-2">
        <FileCheck2Icon className="size-3.5 text-zinc-300" aria-hidden />
        <span className="text-[11px] text-zinc-100">{title}</span>
        <span>#{receipt.id}</span>
        <VerdictBadge verdict={d.verdict} clearance={d.clearance} />
        <span className={cn("rounded-sm border px-1.5 py-px tracking-wider", REVIEW_STYLE[receipt.humanReviewStatus])}>
          REVIEW {receipt.humanReviewStatus}
        </span>
        {d.policyFictional && <FictionalTag />}
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-2 gap-y-0.5">
        <dt>source assets</dt>
        <dd className="break-all text-zinc-200">{receipt.sourceAssetIds.join(", ")}</dd>
        {receipt.derivativeAssetId && (
          <>
            <dt>derivative asset</dt>
            <dd className="text-sky-300">{receipt.derivativeAssetId} (distinct asset · own decision)</dd>
          </>
        )}
        <dt>edit</dt>
        <dd className="text-zinc-200">
          {receipt.edit.title}
          {receipt.edit.derived && <span className="text-sky-300"> · derived from {receipt.edit.derivedFrom ?? "original"}</span>}
          <span className="block text-zinc-500">
            {receipt.edit.segments.map((s) => `${s.scoreplayMediaId} ${tcRange(s.start, s.end)}`).join(" | ")}
          </span>
        </dd>
        <dt>intent</dt>
        <dd className="text-zinc-200">
          {receipt.intent.territory} / {receipt.intent.platform} / {receipt.intent.usage} / {receipt.intent.competition} /{" "}
          {utc(receipt.intent.publishAt)}
        </dd>
        <dt>policy</dt>
        <dd className="text-zinc-200">
          {d.policyId} v{d.policyVersion}
        </dd>
        <dt>rules</dt>
        <dd className="text-zinc-300">
          {d.reasons
            .filter((r) => r.outcome !== "PERMIT")
            .map((r) => `${r.outcome} ${r.ruleId}${r.start !== undefined ? ` @${tcRange(r.start, r.end)}` : ""}`)
            .join(" · ") || "all mandatory dimensions permitted"}
        </dd>
        <dt>evidence</dt>
        <dd className="text-zinc-300">{d.evidence.length} timecoded item{d.evidence.length === 1 ? "" : "s"}</dd>
        <dt>created</dt>
        <dd className="text-zinc-300">{utc(receipt.createdAt)}</dd>
        <dt>human review</dt>
        <dd className="text-zinc-300">
          {receipt.reviews.length === 0
            ? "no reviewer action yet"
            : receipt.reviews.map((r) => `${r.status} by ${r.reviewer} @ ${utc(r.at)}`).join(" · ")}
        </dd>
      </dl>
    </div>
  );
}

export function ReceiptPanel({
  edit,
  intent,
  receipt,
  session,
  onSignIn,
  onReceipt,
}: {
  edit: EditPlan | null;
  intent: PublishIntent | null;
  receipt: ReceiptView | null;
  session: ReviewerSession | null;
  onSignIn: () => void;
  onReceipt: (r: ReceiptView) => void;
}) {
  const [busy, setBusy] = useState<null | "create" | "review" | "render">(null);
  const [error, setError] = useState<{ op: string; err: unknown } | null>(null);
  const [render, setRender] = useState<{ receipt: ReceiptView; outputUrl?: string } | null>(null);
  const reviewer = session?.reviewer;

  async function run<T>(op: NonNullable<typeof busy>, fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(op);
    setError(null);
    try {
      return await fn();
    } catch (err) {
      setError({ op, err });
      return undefined;
    } finally {
      setBusy(null);
    }
  }

  const canCreate = edit !== null && intent !== null;
  const forCurrent = receipt !== null && edit !== null && receipt.edit.id === edit.id;

  return (
    <div className="space-y-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!canCreate || busy !== null}
          onClick={async () => {
            const r = await run("create", () => api.createReceipt({ edit: edit!, intent: intent! }));
            if (r) onReceipt(r);
          }}
        >
          {busy === "create" ? <Loader2Icon className="animate-spin" /> : <FileCheck2Icon />}
          {receipt && forCurrent ? "Re-issue receipt" : "Create Rights Receipt"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canCreate || busy !== null}
          onClick={async () => {
            const r = await run("render", () => api.render({ edit: edit!, intent: intent! }));
            if (r) setRender(r);
          }}
        >
          {busy === "render" ? <Loader2Icon className="animate-spin" /> : <ClapperboardIcon />}
          Render derivative
        </Button>
        {receipt && !forCurrent && (
          <span className="text-[10px] text-amber-300">Receipt below is for a different edit than the one on screen.</span>
        )}
      </div>

      {error?.op === "create" && <ErrorState error={error.err} />}
      {error?.op === "render" && <ErrorState error={error.err} service="Media processing" />}

      {!receipt && !error && (
        <p className="text-xs text-zinc-500">No receipt yet. A receipt records rules, evidence, policy version and review state.</p>
      )}

      {receipt && (
        <>
          <ReceiptSummary receipt={receipt} title="Rights Receipt" />

          <div className="flex flex-wrap items-center gap-2">
            {reviewer ? (
              <>
                <span className="text-[11px] text-zinc-400">
                  Reviewing as <strong className="text-zinc-200">{reviewer.name}</strong>
                </span>
                {(["APPROVED", "REJECTED"] as const).map((status) => (
                  <Button
                    key={status}
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy !== null}
                    className={status === "APPROVED" ? "text-emerald-300" : "text-red-300"}
                    onClick={async () => {
                      const r = await run("review", () => reviewApi.review(receipt.id, status));
                      if (r) onReceipt(r);
                    }}
                  >
                    {status === "APPROVED" ? <CheckIcon /> : <XIcon />}
                    {status === "APPROVED" ? "Approve" : "Reject"}
                  </Button>
                ))}
              </>
            ) : (
              <Button type="button" size="sm" variant="outline" disabled={session?.enabled === false} onClick={onSignIn}>
                <LogInIcon /> {session?.enabled === false ? "Reviewer sign-in not configured" : "Sign in to review"}
              </Button>
            )}
          </div>
          {error?.op === "review" && <ErrorState error={error.err} />}

          <div className="space-y-1 border-t border-white/5 pt-2">
            <h3 className="text-[10px] tracking-widest text-zinc-500 uppercase">ScorePlay writeback</h3>
            <WritebackAction receiptId={receipt.id} session={session} onSignIn={onSignIn} onDone={(r) => onReceipt(r.receipt)} />
          </div>
          {receipt.writeback.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] tracking-widest text-zinc-500 uppercase">ScorePlay writeback attempts</h3>
              <WritebackLog entries={receipt.writeback} />
            </div>
          )}
        </>
      )}

      {render && (
        <div className="space-y-2">
          <ReceiptSummary receipt={render.receipt} title="Derivative receipt (new asset)" />
          {render.outputUrl && (
            <video
              src={render.outputUrl}
              controls
              className="aspect-video w-full rounded border border-white/10 bg-black"
              aria-label="Rendered derivative preview"
            />
          )}
        </div>
      )}
    </div>
  );
}
