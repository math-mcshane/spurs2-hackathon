"use client";

import { useState } from "react";
import { CheckIcon, ClapperboardIcon, DatabaseIcon, FileCheck2Icon, Loader2Icon, XIcon } from "lucide-react";
import type { EditPlan, PublishIntent } from "@/lib/contracts";
import type { ReceiptView } from "@/lib/api-client";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { ErrorState, FictionalTag, VerdictBadge, tcRange } from "./shared";

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
        <VerdictBadge verdict={d.verdict} />
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
          {new Date(receipt.intent.publishAt).toLocaleString()}
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
        <dd className="text-zinc-300">{new Date(receipt.createdAt).toLocaleString()}</dd>
        <dt>human review</dt>
        <dd className="text-zinc-300">
          {receipt.reviews.length === 0
            ? "no reviewer action yet"
            : receipt.reviews.map((r) => `${r.status} by ${r.reviewer} @ ${new Date(r.at).toLocaleTimeString()}`).join(" · ")}
        </dd>
      </dl>
    </div>
  );
}

export function ReceiptPanel({
  edit,
  intent,
  receipt,
  onReceipt,
}: {
  edit: EditPlan | null;
  intent: PublishIntent | null;
  receipt: ReceiptView | null;
  onReceipt: (r: ReceiptView) => void;
}) {
  const [busy, setBusy] = useState<null | "create" | "review" | "writeback" | "render">(null);
  const [error, setError] = useState<{ op: string; err: unknown } | null>(null);
  const [reviewer, setReviewer] = useState("");
  const [readBack, setReadBack] = useState<Record<string, unknown> | null>(null);
  const [render, setRender] = useState<{ receipt: ReceiptView; outputUrl?: string } | null>(null);

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
            if (r) {
              setReadBack(null);
              onReceipt(r);
            }
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

          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-0.5">
              <Label htmlFor="reviewer" className="text-[10px] tracking-widest text-zinc-500 uppercase">Reviewer</Label>
              <Input
                id="reviewer"
                value={reviewer}
                onChange={(e) => setReviewer(e.target.value)}
                placeholder="your name"
                className="h-7 w-36 text-xs"
              />
            </div>
            {(["APPROVED", "REJECTED"] as const).map((status) => (
              <Button
                key={status}
                type="button"
                size="sm"
                variant="outline"
                disabled={!reviewer.trim() || busy !== null}
                className={status === "APPROVED" ? "text-emerald-300" : "text-red-300"}
                onClick={async () => {
                  const r = await run("review", () => api.review(receipt.id, { status, reviewer: reviewer.trim() }));
                  if (r) onReceipt(r);
                }}
              >
                {status === "APPROVED" ? <CheckIcon /> : <XIcon />}
                {status === "APPROVED" ? "Approve" : "Reject"}
              </Button>
            ))}
            <Button
              type="button"
              size="sm"
              className="ml-auto bg-teal-500 text-teal-950 hover:bg-teal-400"
              disabled={busy !== null}
              onClick={async () => {
                const r = await run("writeback", () => api.writeback(receipt.id));
                if (r) {
                  onReceipt(r.receipt);
                  setReadBack(r.readBack);
                }
              }}
            >
              {busy === "writeback" ? <Loader2Icon className="animate-spin" /> : <DatabaseIcon />}
              Write to ScorePlay
            </Button>
          </div>
          {error?.op === "review" && <ErrorState error={error.err} />}
          {error?.op === "writeback" && <ErrorState error={error.err} service="ScorePlay" />}

          {receipt.writeback.length > 0 && (
            <div className="space-y-1">
              <h3 className="text-[10px] tracking-widest text-zinc-500 uppercase">ScorePlay writeback</h3>
              <ul className="space-y-0.5 font-mono text-[10px]">
                {receipt.writeback.map((w, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-sm border px-1 tracking-wider",
                        w.status === "VERIFIED"
                          ? "border-emerald-500/50 text-emerald-300"
                          : w.status === "WRITTEN"
                            ? "border-sky-500/50 text-sky-300"
                            : "border-red-500/50 text-red-300",
                      )}
                    >
                      {w.status}
                    </span>
                    <span className="text-zinc-300">{w.scoreplayMediaId}</span>
                    <span className="text-zinc-500">{new Date(w.at).toLocaleTimeString()}</span>
                    {w.detail && <span className="text-zinc-400">{w.detail}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {readBack && (
            <div className="space-y-1">
              <h3 className="text-[10px] tracking-widest text-zinc-500 uppercase">Read back from ScorePlay (persistence proof)</h3>
              <dl className="grid max-h-40 grid-cols-[minmax(6rem,auto)_1fr] gap-x-2 gap-y-0.5 overflow-auto rounded border border-white/5 bg-zinc-950 p-2 font-mono text-[10px]">
                {Object.entries(readBack).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-zinc-500">{k}</dt>
                    <dd className="break-all text-zinc-200">{typeof v === "string" ? v : JSON.stringify(v)}</dd>
                  </div>
                ))}
              </dl>
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
