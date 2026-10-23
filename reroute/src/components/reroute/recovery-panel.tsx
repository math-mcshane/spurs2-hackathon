"use client";

import { ArrowRightIcon, BanIcon, Loader2Icon, MailIcon, ScissorsIcon, Undo2Icon, WandSparklesIcon } from "lucide-react";
import type { EditDecision, Segment } from "@/lib/contracts";
import type { RecoverResponse } from "@/lib/api-client";
import type { RecoveryKind, RecoveryOption } from "@/features/pulse/types";
import { EditPlanView } from "@/features/pulse/studio/ComplianceEditor";
import { CHANNEL_LABEL, DemoPolicyNote, StatusPill, country, displayTitle, rightsStatus, usageWord } from "@/features/pulse/studio/parts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ErrorState, VerdictBadge, tcRange } from "./shared";

export type RecoveryState =
  | { status: "idle" }
  | { status: "loading"; segmentIndex: number }
  | { status: "done"; segmentIndex: number; segment: Segment; res: RecoverResponse }
  | { status: "error"; error: unknown };

/** The last option applied to the desk's edit or intent (the desk re-decides it on its own). */
export type AppliedRecovery = { title: string; kind: RecoveryKind };

const KIND_LABEL: Record<RecoveryKind, string> = {
  TRIM: "Cut the restricted seconds",
  SAFE_SECTION: "Use only the clean section",
  REPLACE: "Use another moment",
  ADAPT_CAMPAIGN: "Change where / on which channel",
  CHANGE_USAGE: "Change the type of post",
  REQUEST_CLEARANCE: "Ask for clearance",
};

/** What the desk can do with an option: change its edit, switch footage, change its single intent, or nothing. */
export function deskAction(o: RecoveryOption): "CUT" | "REPLACE" | "INTENT" | null {
  if (!o.applicable) return null;
  if ((o.kind === "TRIM" || o.kind === "SAFE_SECTION") && o.timeline && o.timeline.retained.length > 0) return "CUT";
  if (o.kind === "REPLACE" && o.replacement) return "REPLACE";
  if ((o.kind === "ADAPT_CAMPAIGN" || o.kind === "CHANGE_USAGE") && o.campaignChange) return "INTENT";
  return null;
}

const ACTION_LABEL = { CUT: "Apply cut", REPLACE: "Use this clip", INTENT: "Apply to intent" } as const;
/** Remaining restrictions listed per option; the rest are counted (the desk panel stays compact). */
const MAX_REMAINING = 2;

/**
 * "Find a way to use it" on the desk (POST /api/recover, read-only): the restrictions located in the footage or
 * in the intent, and every option the recovery engine proposed with its own independent re-check. Applying an
 * option changes the desk's edit or intent; the desk then decides it again itself (never trusts the plan's verdict).
 */
export function RecoveryPanel({
  target,
  state,
  applied,
  decision,
  deciding,
  onFind,
  onApply,
  onUndo,
}: {
  /** First BLOCKED / NEEDS_REVIEW segment of the desk's edit, or null when everything is ALLOWED (or undecided). */
  target: number | null;
  state: RecoveryState;
  applied: AppliedRecovery | null;
  /** The desk's current decision (shown next to an applied option: the re-decision). */
  decision: EditDecision | null;
  deciding: boolean;
  onFind: (segmentIndex: number) => void;
  onApply: (o: RecoveryOption) => void;
  onUndo: () => void;
}) {
  return (
    <div className="space-y-3 p-3">
      {applied && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-[11px] text-sky-100">
          <span>
            Applied <strong>{applied.title}</strong> · the desk re-decided:
          </span>
          {deciding || !decision ? (
            <span className="inline-flex items-center gap-1 text-sky-200">
              <Loader2Icon className="size-3 animate-spin" aria-hidden /> deciding…
            </span>
          ) : (
            <>
              <VerdictBadge verdict={decision.decision.verdict} clearance={decision.decision.clearance} />
              <span className="text-sky-200/80">
                {decision.segments.map((s) => `${tcRange(s.segment.start, s.segment.end)} ${s.decision.verdict === "ALLOWED" && s.decision.clearance === "DEMO" ? "ALLOWED · DEMO" : s.decision.verdict.replace("_", " ")}`).join(" · ")}
              </span>
            </>
          )}
          <Button type="button" size="xs" variant="ghost" className="ml-auto text-sky-200" onClick={onUndo}>
            <Undo2Icon /> Undo
          </Button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={() => target !== null && onFind(target)}
          disabled={target === null || state.status === "loading"}
          className="bg-sky-500 text-sky-950 hover:bg-sky-400"
        >
          {state.status === "loading" ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />}
          Find a way to use it
        </Button>
        <span className="text-[11px] text-zinc-400">
          {target === null
            ? "Available when a segment is BLOCKED or needs review."
            : `For segment #${target + 1}: cuts, a clean section, other moments, intent changes — each re-checked independently.`}
        </span>
      </div>

      {state.status === "loading" && (
        <p role="status" className="text-[11px] text-sky-200">
          Locating the restriction → proposing cuts, clean sections and replacement moments → re-checking each option… (up to ~70 s on a cold cache)
        </p>
      )}
      {state.status === "error" && <ErrorState error={state.error} service="TwelveLabs" />}
      {state.status === "done" && <RecoveryResult state={state} onApply={onApply} />}
    </div>
  );
}

function RecoveryResult({ state, onApply }: { state: Extract<RecoveryState, { status: "done" }>; onApply: (o: RecoveryOption) => void }) {
  const { recovery, notes, policy } = state.res;
  const chosen = { start: state.segment.start, end: state.segment.end };
  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className="text-xs text-zinc-200">
          <span className="font-mono text-[10px] text-zinc-500">
            {recovery.scope} · segment #{state.segmentIndex + 1} {tcRange(chosen.start, chosen.end)}
          </span>{" "}
          · {recovery.problem.headline}
        </p>
        {recovery.problem.items.length > 0 && (
          <ul className="space-y-1 text-[11px] text-zinc-300">
            {recovery.problem.items.map((p, i) => (
              <li key={i} className="flex gap-2">
                <BanIcon className="mt-0.5 size-3 shrink-0 text-red-300" aria-hidden />
                <span>
                  {p.text}
                  {p.at && <span className="font-mono text-zinc-500"> · {tcRange(p.at.start, p.at.end)}</span>}
                  <span className="block text-[10px] text-zinc-500">{p.source}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <DemoPolicyNote label={policy?.label} className="text-[11px]" />
        {policy && (
          <p className="font-mono text-[10px] text-zinc-500">
            Rule package: {policy.title} · v{policy.version}
          </p>
        )}
        {recovery.noPathMessage && <p className="text-[11px] text-amber-200">{recovery.noPathMessage}</p>}
        {notes.map((n) => (
          <p key={n} className="text-[10px] text-zinc-500">
            {n}
          </p>
        ))}
      </div>

      {recovery.options.length === 0 ? (
        <p className="text-xs text-zinc-500">No option was found for this segment.</p>
      ) : (
        <ul className="divide-y divide-white/5 rounded-md border border-white/8">
          {recovery.options.map((o) => (
            <OptionItem key={o.id} option={o} chosen={chosen} onApply={() => onApply(o)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OptionItem({ option: o, chosen, onApply }: { option: RecoveryOption; chosen: { start: number; end: number }; onApply: () => void }) {
  const action = deskAction(o);
  const rejected = o.outcome === "NOT_VIABLE";
  const next = o.outcome === "NEXT_STEP";
  const status = o.recheck ? rightsStatus(o.recheck.verdict, o.recheck.clearance) : null;
  const ch = o.campaignChange;
  return (
    <li className={cn("space-y-2 px-3 py-3", o.recommended && "bg-sky-500/5")}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <p className="text-[10px] tracking-widest text-zinc-500 uppercase">
            {KIND_LABEL[o.kind]}
            {o.recommended && <span className="ml-2 rounded bg-sky-500 px-1 font-mono text-[9px] text-sky-950">RECOMMENDED</span>}
          </p>
          <p className={cn("text-sm font-medium", rejected ? "text-zinc-400" : "text-zinc-100")}>{o.title}</p>
        </div>
        <span className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-zinc-500">{o.outcome}</span>
          {rejected ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-500">
              <BanIcon className="size-3.5" aria-hidden /> Rejected
            </span>
          ) : next ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
              <ArrowRightIcon className="size-3.5" aria-hidden /> Next step
            </span>
          ) : (
            status &&
            o.recheck && (
              <StatusPill status={status} label={`${status === "provisional" ? "Allowed · demo policy" : STATUS_WORD[status] ?? status} · ${o.recheck.allowedUses} of ${o.recheck.totalUses}`} />
            )
          )}
        </span>
      </div>

      {rejected && o.notViableBecause && <p className="text-[11px] text-zinc-400">{o.notViableBecause}</p>}
      <p className="text-[11px] text-zinc-300">{o.summary}</p>
      {o.timeline && <EditPlanView timeline={o.timeline} chosen={chosen} compact />}
      {o.replacement && (
        <p className="text-[11px] text-zinc-300">
          <span className="font-mono text-zinc-100">{tcRange(o.replacement.start, o.replacement.end)}</span> of{" "}
          <span className="text-zinc-100">{displayTitle(o.replacement.title)}</span>{" "}
          <span className="font-mono text-[10px] text-zinc-500">
            ScorePlay {o.replacement.scoreplayMediaId} · search rank {o.replacement.rank} for “{o.replacement.query}”
          </span>
        </p>
      )}
      {ch && (
        <p className="text-[11px] text-zinc-300">
          {[
            ch.territories && `Markets: ${ch.territories.map(country).join(", ")}`,
            ch.dropped?.length && `drops ${ch.dropped.map(country).join(", ")}`,
            ch.platforms && `Channels: ${ch.platforms.map((p) => CHANNEL_LABEL[p] ?? p).join(", ")}`,
            ch.usage && `${usageWord(ch.usage)} post`,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
      {!rejected && !next && <p className="text-[10px] text-zinc-500">Trade-off: {o.tradeoff}</p>}
      {o.recheck && o.recheck.remaining.length > 0 && (
        <ul className="space-y-0.5 text-[10px] text-zinc-400">
          {o.recheck.remaining.slice(0, MAX_REMAINING).map((r, i) => (
            <li key={i}>
              Still: {r.text}
              {r.at && <span className="font-mono"> · {tcRange(r.at.start, r.at.end)}</span>} <span className="text-zinc-500">({r.source})</span>
            </li>
          ))}
          {o.recheck.remaining.length > MAX_REMAINING && <li className="text-zinc-500">+{o.recheck.remaining.length - MAX_REMAINING} more restrictions</li>}
        </ul>
      )}
      {o.outcome === "RESOLVES_DEMO" && <p className="text-[10px] text-amber-200/90">Allowed under the demo policy — not legal clearance.</p>}

      {action ? (
        <Button type="button" size="xs" variant={o.recommended ? "default" : "outline"} onClick={onApply}>
          {action === "CUT" ? <ScissorsIcon /> : <WandSparklesIcon />}
          {ACTION_LABEL[action]}
        </Button>
      ) : (
        o.kind === "REQUEST_CLEARANCE" && (
          <p className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <MailIcon className="size-3" aria-hidden /> A human action — nothing to apply on the desk.
          </p>
        )
      )}
    </li>
  );
}

const STATUS_WORD: Partial<Record<string, string>> = { clear: "Cleared", blocked: "Blocked", review: "Needs review" };
