"use client";

import { ArrowRightIcon, ChevronRightIcon, FileSearchIcon, Loader2Icon, RefreshCwIcon, RouteIcon, ScaleIcon, SendIcon } from "lucide-react";
import { Reveal, Swap } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { utc } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import type { GoalView } from "../types";
import { BeforeAfterPanel, ComplianceEditor, momentSpan } from "./ComplianceEditor";
import {
  CHANNEL_LABEL,
  PolicyContext,
  Eyebrow,
  IssueBlock,
  StagedProgress,
  StatusMark,
  StatusPill,
  country,
  groupIssues,
  rightsStatus,
  usesPhrase,
  type Stage,
  type Issue,
  type Status,
} from "./parts";
import { PolicyPicker } from "./PolicyPicker";

export type LensBusy = "rights" | "recovery" | "policy" | "submit" | `apply:${string}` | null;

const REVIEW_LINE: Record<Exclude<GoalView["reviewStatus"], "NOT_SUBMITTED">, string> = {
  PENDING: "Submitted · waiting for a reviewer",
  APPROVED: "Approved by a reviewer",
  REJECTED: "Rejected by a reviewer",
};

type Props = {
  goal: GoalView;
  busy: LensBusy;
  /** Any action is running: every control is disabled. */
  disabled: boolean;
  progress?: { stages: Stage[]; note?: string };
  onCheck: () => void;
  onFindRecovery: () => void;
  onApplyRecovery: (optionId: string) => void;
  onSetPolicy: (packageId: string) => void;
  onSubmit: () => void;
  onOpenReview: () => void;
  onChooseAsset: () => void;
  onEditGoal: () => void;
  deskHref: string;
};

/**
 * Rights Lens — "Can I use this media for this campaign?" The rules it is judged against, one decision, the
 * problems behind it (what was OBSERVED kept apart from what the RULE says) and one next action. When the
 * campaign is restricted, "Find a way to use it" opens the Compliance Editor inside the Lens so the campaign
 * never leaves the screen; after a correction is applied, the Lens shows the verdict before and after.
 */
export function RightsLens(props: Props) {
  const { goal, busy, disabled, progress } = props;
  const r = goal.rights;
  const checked = r.state !== "NOT_CHECKED";
  const stale = checked && !r.current;
  const status: Status = stale ? "stale" : rightsStatus(r.state, r.clearance);
  const restricted = r.current && (r.state === "BLOCKED" || r.state === "NEEDS_REVIEW");
  /** Recovery options exist only for the latest evaluation: a stale search is never shown or usable. */
  const recovery = goal.recovery && r.current && goal.recovery.forEvaluationId === r.evaluationId ? goal.recovery : undefined;
  const applyingId = busy?.startsWith("apply:") ? busy.slice(6) : null;
  const issues = r.current ? groupIssues(r.perIntent) : [];
  const recheck = busy === "rights" || busy === "policy";
  const plan = goal.campaign?.plan ?? goal.run.plan;

  return (
    <section aria-labelledby="lens-title" aria-busy={busy !== null} className="overflow-hidden rounded-xl bg-surface ring-1 ring-line ring-inset">
      <header className="space-y-3 px-6 pt-5">
        <div className="flex items-center justify-between gap-3">
          <Eyebrow>
            <span id="lens-title">Rights</span>
          </Eyebrow>
          {r.evaluatedAt && !recheck && (
            <p className="text-meta text-ink-muted">
              {r.kind === "ALTERNATIVE" ? "Re-checked" : "Checked"} {utc(r.evaluatedAt)}
            </p>
          )}
        </div>
        <PolicyRow goal={goal} disabled={disabled || goal.reviewStatus !== "NOT_SUBMITTED"} onSetPolicy={props.onSetPolicy} />
      </header>

      <div className="px-6 pt-5 pb-6">
        <Swap id={recheck ? "progress" : `${r.evaluationId ?? "none"}:${status}`}>
          {recheck && progress ? (
            <StagedProgress stages={progress.stages} note={progress.note} className="py-2" />
          ) : (
            <Decision goal={goal} status={status} issues={issues} />
          )}
        </Swap>
      </div>

      {goal.beforeAfter && !recovery && !recheck && (
        <Reveal className="border-t border-line px-6 py-6">
          <BeforeAfterPanel beforeAfter={goal.beforeAfter} chosen={momentSpan(goal, goal.beforeAfter.before.key)} totalNow={r.perIntent.length || undefined} />
        </Reveal>
      )}

      {recovery && !recheck ? (
        <Reveal className="border-t border-line px-6 py-6">
          <ComplianceEditor
            key={recovery.id}
            goal={goal}
            recovery={recovery}
            disabled={disabled}
            applyingId={applyingId}
            applyProgress={applyingId ? progress : undefined}
            onApply={props.onApplyRecovery}
            onChooseAsset={props.onChooseAsset}
            onChangeSettings={props.onEditGoal}
            onSubmit={props.onSubmit}
          />
        </Reveal>
      ) : busy === "recovery" && progress ? (
        <div className="border-t border-line px-6 py-6">
          <StagedProgress stages={progress.stages} note={progress.note} />
        </div>
      ) : (
        !recheck && (
          <div className="space-y-3 border-t border-line px-6 py-5">
            <Actions {...props} stale={stale} restricted={!!restricted} />
            {busy === "submit" && progress && <StagedProgress stages={progress.stages} note={progress.note} />}
          </div>
        )
      )}
      {recovery && busy === "submit" && progress && (
        <div className="border-t border-line px-6 py-5">
          <StagedProgress stages={progress.stages} note={progress.note} />
        </div>
      )}

      {issues.length > 0 && !recheck && (
        <Disclosure
          open={!recovery && !goal.beforeAfter}
          title={`What we found · ${issues.length} ${issues.length === 1 ? "issue" : "issues"}`}
          className="border-t border-line"
        >
          <ul className="divide-y divide-line">
            {issues.map((issue) => (
              <IssueBlock key={issue.key} issue={issue} />
            ))}
          </ul>
        </Disclosure>
      )}

      {checked && r.perIntent.length > 0 && !recheck && (
        <Disclosure
          title={stale ? `Previous check · ${r.perIntent.length} uses` : `All ${r.perIntent.length} uses · ${usesPhrase(plan.channels, plan.territories)}`}
          className="border-t border-line"
        >
          <ul className="space-y-2">
            {r.perIntent.map((p) => (
              <li key={`${p.channel}-${p.territory}`} className="flex items-center justify-between gap-3 text-small">
                <span className="min-w-0 truncate text-ink-soft">
                  {CHANNEL_LABEL[p.channel] ?? p.channel} · {country(p.territory)}
                </span>
                <StatusPill status={stale ? "stale" : rightsStatus(p.verdict, p.clearance)} label={stale ? "Previous check" : undefined} />
              </li>
            ))}
          </ul>
          <a href={props.deskHref} className="mt-4 inline-flex items-center gap-1.5 text-meta text-ink-muted underline-offset-4 hover:text-ink hover:underline">
            <FileSearchIcon className="size-3.5" aria-hidden /> Open frame-level evidence in the rights desk
          </a>
        </Disclosure>
      )}
    </section>
  );
}

/** The rule package the campaign is judged against, the one policy-context indicator, and the switch to another package. */
function PolicyRow({ goal, disabled, onSetPolicy }: { goal: GoalView; disabled: boolean; onSetPolicy: (packageId: string) => void }) {
  const p = goal.policy;
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-t border-line pt-3">
      <div className="flex min-w-0 items-start gap-2">
        <ScaleIcon className="mt-0.5 size-3.5 shrink-0 text-ink-muted" aria-hidden />
        <div className="min-w-0">
          <p className="text-small text-ink-soft">{p ? p.title : "Club rights policy"}</p>
          {p && <PolicyContext verified={p.verified} sourceType={p.sourceType} className="mt-1" />}
        </div>
      </div>
      <PolicyPicker club={goal.run.club} value={p?.packageId} disabled={disabled} triggerLabel="Change rules" runId={goal.run.id} onChange={onSetPolicy} />
    </div>
  );
}

/** The answer, in one line, then its scope. */
function Decision({ goal, status, issues }: { goal: GoalView; status: Status; issues: Issue[] }) {
  const r = goal.rights;
  const plan = goal.campaign?.plan ?? goal.run.plan;
  const allowed = r.perIntent.filter((p) => p.verdict === "ALLOWED").length;
  const total = r.perIntent.length;
  const headline: Record<Status, string> = {
    idle: "Not checked yet",
    stale: "Needs a fresh check",
    clear: "Cleared for this campaign",
    provisional: "Allowed under these rules",
    blocked: "Can’t be used as planned",
    review: "Not cleared for every use",
  };
  const sub =
    status === "idle"
      ? `Each use is checked separately: ${usesPhrase(plan.channels, plan.territories)}.`
      : status === "stale"
        ? `The campaign or its rules changed after the last check (${allowed} of ${total} uses allowed then). Check again before review.`
        : `${allowed} of ${total} uses allowed · ${usesPhrase(plan.channels, plan.territories)}`;
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="flex items-start gap-4">
        <StatusMark status={status} />
        <div className="min-w-0">
          <h2 className="font-display text-headline font-medium text-ink">{headline[status]}</h2>
          <p className="mt-1.5 text-small text-ink-muted">{sub}</p>
          {issues.length > 0 && (
            <p className="mt-2 text-small">
              {/* One name per topic: two rules about people on screen are still "People on screen" once here. */}
              {issues.filter((i, n) => issues.findIndex((x) => x.topic === i.topic && x.outcome === i.outcome) === n).map((i, n) => (
                <span key={i.key} className={i.outcome === "DENY" ? "text-status-blocked" : "text-status-review"}>
                  {n > 0 && <span className="px-1.5 text-ink-muted">·</span>}
                  {i.topic}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
      {r.current && goal.reviewStatus !== "NOT_SUBMITTED" && (
        <p className="flex items-center gap-2 text-small text-ink-soft">
          <span className={cn("size-1.5 rounded-full", goal.reviewStatus === "PENDING" ? "bg-status-review" : goal.reviewStatus === "APPROVED" ? "bg-ink" : "bg-status-blocked")} aria-hidden />
          {REVIEW_LINE[goal.reviewStatus]}
        </p>
      )}
    </div>
  );
}

/** One primary action for where the campaign is; everything else is quiet. */
function Actions({ goal, busy, disabled, stale, restricted, onCheck, onFindRecovery, onSubmit, onOpenReview }: Props & { stale: boolean; restricted: boolean }) {
  const r = goal.rights;
  const recheckLink = (
    <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onCheck}>
      <RefreshCwIcon /> Check again
    </Button>
  );
  const primary = "h-10 w-full rounded-lg px-4 text-[0.9375rem] font-semibold sm:w-auto";

  if (r.state === "NOT_CHECKED" || stale)
    return (
      <Button size="lg" className={primary} disabled={disabled} onClick={onCheck}>
        {busy === "rights" && <Loader2Icon className="animate-spin" />}
        {stale ? "Check rights again" : "Check rights"}
        <ArrowRightIcon />
      </Button>
    );

  if (goal.reviewStatus !== "NOT_SUBMITTED")
    return (
      <Button size="lg" variant={goal.reviewStatus === "PENDING" ? "default" : "outline"} className={primary} onClick={onOpenReview}>
        {goal.reviewStatus === "PENDING" ? "Open review" : "View audit receipt"} <ArrowRightIcon />
      </Button>
    );

  if (restricted)
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <Button size="lg" className={primary} disabled={disabled} onClick={onFindRecovery}>
          {busy === "recovery" ? <Loader2Icon className="animate-spin" /> : <RouteIcon />} Find a way to use it
        </Button>
        {goal.canSubmit && (
          <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onSubmit}>
            Send for human review as is
          </Button>
        )}
        {recheckLink}
      </div>
    );

  if (goal.canSubmit)
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <Button size="lg" className={primary} disabled={disabled} onClick={onSubmit}>
          {busy === "submit" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Send for human review
        </Button>
        {recheckLink}
      </div>
    );

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-meta text-ink-muted">Review unlocks once a use is allowed.</p>
      {recheckLink}
    </div>
  );
}

function Disclosure({ title, open, className, children }: { title: string; open?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <details open={open} className={cn("group/x", className)}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 text-small text-ink-soft transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 truncate">{title}</span>
        <ChevronRightIcon className="size-4 shrink-0 text-ink-muted transition-transform group-open/x:rotate-90" aria-hidden />
      </summary>
      <div className="px-6 pb-6">{children}</div>
    </details>
  );
}
