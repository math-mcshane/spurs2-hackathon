"use client";

import { BanIcon, CheckCircle2Icon, Loader2Icon, SendIcon, ShieldQuestionIcon } from "lucide-react";
import type { EditDecision, Reason } from "@/lib/contracts";
import type { AccessResponseSchema } from "@/lib/contracts";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ErrorState, FictionalTag, OriginBadge, VERDICT_STYLE, evidenceOrigin, tcRange } from "./shared";

export type AccessResult = z.infer<typeof AccessResponseSchema>;
export type AccessState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; res: AccessResult }
  | { status: "error"; error: unknown };

const OUTCOME_STYLE: Record<Reason["outcome"], string> = {
  DENY: "border-red-500/50 text-red-300",
  MISSING: "border-amber-500/50 text-amber-300",
  PERMIT: "border-emerald-500/40 text-emerald-300",
};
const ORDER: Record<Reason["outcome"], number> = { DENY: 0, MISSING: 1, PERMIT: 2 };

function ReasonRow({ r }: { r: Reason }) {
  return (
    <li className="grid grid-cols-[auto_1fr] gap-x-2 border-b border-white/5 py-1.5 last:border-0">
      <span className={cn("h-fit rounded-sm border px-1 font-mono text-[9px] tracking-wider", OUTCOME_STYLE[r.outcome])}>
        {r.outcome}
      </span>
      <div className="min-w-0 space-y-0.5">
        <div className="flex flex-wrap items-baseline gap-x-2 font-mono text-[10px]">
          <span className="text-zinc-200">{r.ruleId}</span>
          <span className="text-zinc-500">dimension: {r.dimension}</span>
          {r.basis && <span className="text-zinc-500">basis: {r.basis}</span>}
          {(r.start !== undefined || r.end !== undefined) && (
            <span className="text-zinc-400">
              {r.scoreplayMediaId ? `${r.scoreplayMediaId} · ` : ""}
              {tcRange(r.start, r.end)}
            </span>
          )}
        </div>
        <p className="text-xs text-zinc-300">{r.explanation}</p>
      </div>
    </li>
  );
}

export function VerdictCard({
  decision,
  pending,
  error,
  incompleteReason,
  access,
  onCheckAccess,
  onUse,
}: {
  decision: EditDecision | null;
  pending: boolean;
  error: unknown;
  /** Why no decision can be requested yet (e.g. intent incomplete). */
  incompleteReason: string | null;
  access: AccessState;
  onCheckAccess: () => void;
  onUse: () => void;
}) {
  if (incompleteReason && !decision) {
    return <p className="px-3 py-6 text-center text-xs text-zinc-500">{incompleteReason}</p>;
  }
  if (error !== null && !decision) {
    return (
      <div className="p-3">
        <ErrorState error={error} service="Policy" />
      </div>
    );
  }
  if (!decision) {
    return (
      <div className="flex items-center justify-center gap-2 px-3 py-6 text-xs text-zinc-500">
        <Loader2Icon className="size-3.5 animate-spin" /> Evaluating every segment…
      </div>
    );
  }

  const d = decision.decision;
  // ALLOWED under a demo policy is never presented as a green clearance.
  const demo = d.verdict === "ALLOWED" && d.clearance === "DEMO";
  const vs = demo ? { ...VERDICT_STYLE.ALLOWED, label: "ALLOWED · DEMO", text: "text-amber-200", bg: "bg-amber-500/15", border: "border-amber-500/50" } : VERDICT_STYLE[d.verdict];
  const reasons = [...d.reasons].sort((a, b) => ORDER[a.outcome] - ORDER[b.outcome]);
  const decisive = reasons.filter((r) => r.outcome !== "PERMIT");
  const permits = reasons.filter((r) => r.outcome === "PERMIT");
  const confident = d.evidence.filter((e) => e.confidence !== undefined);

  return (
    <div className={cn("space-y-3 p-3 transition-opacity", pending && "opacity-60")} aria-busy={pending}>
      <div className={cn("flex items-center justify-between gap-3 rounded-md border px-3 py-2", vs.border, vs.bg)}>
        <div className="flex items-center gap-2.5">
          {d.verdict === "ALLOWED" ? (
            <CheckCircle2Icon className={cn("size-7", vs.text)} aria-hidden />
          ) : d.verdict === "BLOCKED" ? (
            <BanIcon className={cn("size-7", vs.text)} aria-hidden />
          ) : (
            <ShieldQuestionIcon className={cn("size-7", vs.text)} aria-hidden />
          )}
          <div>
            <div className={cn("font-mono text-2xl leading-none font-black tracking-wider", vs.text)} aria-live="polite">
              {vs.label}
            </div>
            <div className="mt-1 text-[10px] text-zinc-400">
              {decision.edit.title} · {decision.edit.segments.length} segments checked independently
              {decision.edit.derived && " · derived edit (new asset)"}
            </div>
          </div>
        </div>
        {pending && <Loader2Icon className="size-4 animate-spin text-zinc-400" aria-label="Re-evaluating" />}
      </div>

      <div className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-zinc-400">
        <span>
          policy <span className="text-zinc-200">{d.policyId}</span> · v{d.policyVersion} · clearance {d.clearance}
        </span>
        {d.policyFictional && <FictionalTag />}
        <span className="text-zinc-500">evaluated {new Date(d.evaluatedAt).toLocaleTimeString()}</span>
      </div>
      {d.policySelection && (
        <details className="text-[10px] text-zinc-500">
          <summary className="cursor-pointer">Policy selection · {d.policySelection.considered.length} considered</summary>
          <ul className="mt-1 space-y-0.5">
            {d.policySelection.considered.map((p) => (
              <li key={p.policyId}>
                <span className={p.applicable ? "text-emerald-300" : "text-zinc-500"}>{p.applicable ? "applicable" : "not applicable"}</span> {p.policyId}: {p.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      {error !== null && <ErrorState error={error} service="Policy" />}

      <div>
        <h3 className="mb-1 text-[10px] tracking-widest text-zinc-500 uppercase">Rule trace</h3>
        {decisive.length === 0 && permits.length === 0 && <p className="text-xs text-zinc-500">No rules reported.</p>}
        <ul>{decisive.map((r, i) => <ReasonRow key={`d${i}`} r={r} />)}</ul>
        {permits.length > 0 && (
          <details className="mt-1 text-xs">
            <summary className="cursor-pointer text-[10px] text-zinc-500">
              {permits.length} affirmative permission{permits.length === 1 ? "" : "s"}
            </summary>
            <ul>{permits.map((r, i) => <ReasonRow key={`p${i}`} r={r} />)}</ul>
          </details>
        )}
      </div>

      {d.missingFacts.length > 0 && (
        <div>
          <h3 className="mb-1 text-[10px] tracking-widest text-amber-400/80 uppercase">Missing facts → review</h3>
          <ul className="flex flex-wrap gap-1">
            {d.missingFacts.map((f) => (
              <li key={f} className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-200">
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      {confident.length > 0 && (
        <div>
          <h3 className="mb-1 text-[10px] tracking-widest text-zinc-500 uppercase">
            Observation confidence <span className="normal-case">(how sure the detector is of what it saw — not legal confidence)</span>
          </h3>
          <ul className="space-y-1">
            {confident.map((e, i) => (
              <li key={i} className="flex items-center gap-2 text-[11px]">
                <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded bg-zinc-800" aria-hidden>
                  <div className="h-full bg-sky-400" style={{ width: `${(e.confidence ?? 0) * 100}%` }} />
                </div>
                <span className="w-8 shrink-0 font-mono text-[10px] text-zinc-300">{Math.round((e.confidence ?? 0) * 100)}%</span>
                <span className="min-w-0 flex-1 truncate text-zinc-300" title={e.observation}>{e.observation}</span>
                <span className="shrink-0 font-mono text-[9px] text-zinc-500">{tcRange(e.start, e.end)}</span>
                <OriginBadge origin={evidenceOrigin(e)} className="h-4 px-1 text-[9px]" />
              </li>
            ))}
          </ul>
        </div>
      )}

      <AccessAction access={access} decision={decision} onCheckAccess={onCheckAccess} onUse={onUse} disabled={pending} />
    </div>
  );
}

function AccessAction({
  access,
  decision,
  onCheckAccess,
  onUse,
  disabled,
}: {
  access: AccessState;
  decision: EditDecision;
  onCheckAccess: () => void;
  onUse: () => void;
  disabled: boolean;
}) {
  const label = "text-[10px] tracking-widest text-zinc-500 uppercase";
  return (
    <div className="space-y-1.5 border-t border-white/5 pt-3">
      <div className="flex items-center justify-between">
        <h3 className={label}>Access gate · export</h3>
        <span className="text-[9px] text-zinc-500">decided server-side by /api/access</span>
      </div>

      {access.status === "idle" && (
        <Button type="button" size="sm" variant="outline" className="w-full" onClick={onCheckAccess} disabled={disabled}>
          {decision.decision.verdict === "NEEDS_REVIEW" ? <SendIcon /> : <ShieldQuestionIcon />}
          {decision.decision.verdict === "NEEDS_REVIEW" ? "Request review" : "Check export access"}
        </Button>
      )}
      {access.status === "loading" && (
        <Button type="button" size="sm" variant="outline" className="w-full" disabled>
          <Loader2Icon className="animate-spin" /> Asking access gate…
        </Button>
      )}
      {access.status === "error" && (
        <>
          <ErrorState error={access.error} />
          <Button type="button" size="sm" variant="outline" className="w-full" onClick={onCheckAccess}>
            Retry access check
          </Button>
        </>
      )}
      {access.status === "done" && access.res.uiAction === "USE" && access.res.granted && (
        <Button
          type="button"
          size="sm"
          className="w-full bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
          onClick={onUse}
          disabled={disabled}
        >
          <CheckCircle2Icon /> Use — export cleared by gate
        </Button>
      )}
      {access.status === "done" && access.res.uiAction === "BLOCKED" && (
        <>
          <Button type="button" size="sm" variant="destructive" className="w-full" disabled aria-describedby="blocked-why">
            <BanIcon /> Blocked
          </Button>
          <ul id="blocked-why" className="space-y-0.5 text-[11px] text-red-200/90">
            {access.res.decision.reasons
              .filter((r) => r.outcome === "DENY")
              .map((r, i) => (
                <li key={i}>
                  <span className="font-mono text-[10px] text-red-300">{r.ruleId}</span> · {r.explanation}
                  {(r.start !== undefined || r.end !== undefined) && (
                    <span className="font-mono text-[10px] text-red-300/80"> [{tcRange(r.start, r.end)}]</span>
                  )}
                </li>
              ))}
          </ul>
        </>
      )}
      {access.status === "done" && access.res.uiAction === "REQUEST_REVIEW" && (
        <div className="space-y-1">
          <Button type="button" size="sm" variant="outline" className="w-full border-amber-500/50 text-amber-200" disabled>
            <SendIcon /> {access.res.receiptId ? "Review requested" : "Request review"}
          </Button>
          <p className="text-[11px] text-amber-200/90">
            {access.res.receiptId ? (
              <>
                Review receipt <span className="font-mono">{access.res.receiptId}</span> created — a human approver must clear it before release.
              </>
            ) : (
              "The gate requires human review; no receipt id was returned."
            )}
          </p>
        </div>
      )}
      {access.status === "done" && !access.res.granted && access.res.uiAction === "USE" && (
        <p className="text-[11px] text-red-300">Gate returned USE without granting access — treated as not granted.</p>
      )}
    </div>
  );
}
