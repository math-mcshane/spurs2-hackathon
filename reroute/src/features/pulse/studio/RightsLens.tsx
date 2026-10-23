"use client";

import { ArrowRightIcon, ChevronRightIcon, CheckIcon, FileSearchIcon, Loader2Icon, RefreshCwIcon, RouteIcon, SendIcon, XIcon } from "lucide-react";
import { DEMO_CLEARANCE_LABEL } from "@/lib/contracts";
import { Reveal, Swap } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { utc } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import { reasonFinding } from "../goal-view";
import type { AlternativeCandidate, GoalView, RightsView } from "../types";
import { MomentPreview, segmentLabel } from "./MomentPreview";
import {
  CHANNEL_LABEL,
  DemoPolicyNote,
  Eyebrow,
  IssueBlock,
  StagedProgress,
  StatusMark,
  StatusPill,
  country,
  displayTitle,
  groupIssues,
  rightsStatus,
  usesPhrase,
  type Stage,
  type Issue,
  type Status,
} from "./parts";

export type LensBusy = "rights" | "alternatives" | "remedy" | "submit" | `alt:${string}` | null;

/** The label every demo-policy verdict must carry, or null for verified policies. */
function demoLabel(rights: RightsView): string | null {
  if (rights.clearanceLabel) return rights.clearanceLabel;
  return rights.perIntent.some((p) => p.policyFictional) ? DEMO_CLEARANCE_LABEL : null;
}

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
  onFindAnotherWay: () => void;
  onUseAlternative: (key: string) => void;
  onApplyRemedy: () => void;
  onSubmit: () => void;
  onOpenReview: () => void;
  onEditGoal: () => void;
  deskHref: string;
};

/**
 * Rights Lens — "Can I use this media for this campaign?" One decision, the problems behind it (what was
 * OBSERVED kept apart from what the RULE says), the policy and whether it is verified, and one next action.
 * "Find another way" opens inside the Lens so the campaign never leaves the screen.
 */
export function RightsLens(props: Props) {
  const { goal, busy, progress } = props;
  const r = goal.rights;
  const checked = r.state !== "NOT_CHECKED";
  const stale = checked && !r.current;
  const status: Status = stale ? "stale" : rightsStatus(r.state, r.clearance);
  const demo = checked && !stale ? demoLabel(r) : null;
  const restricted = r.current && (r.state === "BLOCKED" || r.state === "NEEDS_REVIEW");
  const alts = goal.alternatives;
  const searched = !!alts && alts.forEvaluationId === r.evaluationId && r.current;
  const issues = r.current ? groupIssues(r.perIntent) : [];
  const recheck = busy === "rights" || busy?.startsWith("alt:");
  const plan = goal.campaign?.plan ?? goal.run.plan;
  const actions = (
    <div className="space-y-3 border-t border-line px-6 py-5">
      <Actions {...props} stale={stale} restricted={!!restricted} searched={searched} />
      {(busy === "submit" || busy === "remedy") && progress && <StagedProgress stages={progress.stages} note={progress.note} />}
    </div>
  );

  return (
    <section aria-labelledby="lens-title" aria-busy={busy !== null} className="overflow-hidden rounded-xl bg-surface ring-1 ring-line ring-inset">
      <header className="flex items-center justify-between gap-3 px-6 pt-5">
        <Eyebrow>
          <span id="lens-title">Rights</span>
        </Eyebrow>
        {r.evaluatedAt && !recheck && (
          <p className="text-meta text-ink-muted">
            {r.kind === "ALTERNATIVE" ? "Re-checked" : "Checked"} {utc(r.evaluatedAt)}
          </p>
        )}
      </header>

      <div className="px-6 pt-4 pb-6">
        <Swap id={recheck ? "progress" : `${r.evaluationId ?? "none"}:${status}`}>
          {recheck && progress ? (
            <StagedProgress stages={progress.stages} note={progress.note} className="py-2" />
          ) : (
            <Decision goal={goal} status={status} demo={demo} issues={issues} />
          )}
        </Swap>
      </div>

      {!recheck && !searched && actions}

      {searched && !recheck && (
        <Reveal className="border-t border-line px-6 py-6">
          <Recovery {...props} />
        </Reveal>
      )}
      {busy === "alternatives" && progress && (
        <div className="border-t border-line px-6 py-6">
          <StagedProgress stages={progress.stages} note={progress.note} />
        </div>
      )}

      {!recheck && searched && actions}

      {issues.length > 0 && !recheck && (
        <Disclosure
          open={!searched}
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

/** The answer, in one line, then its scope, then the policy label when it is fictional. */
function Decision({ goal, status, demo, issues }: { goal: GoalView; status: Status; demo: string | null; issues: Issue[] }) {
  const r = goal.rights;
  const plan = goal.campaign?.plan ?? goal.run.plan;
  const allowed = r.perIntent.filter((p) => p.verdict === "ALLOWED").length;
  const total = r.perIntent.length;
  const headline: Record<Status, string> = {
    idle: "Not checked yet",
    stale: "Your campaign changed",
    clear: "Cleared for this campaign",
    provisional: "Allowed under the demo policy",
    blocked: "Can’t be used as planned",
    review: goal.licenceGap ? goal.licenceGap.label : "Not cleared for every use",
  };
  const sub =
    status === "idle"
      ? `We check ${usesPhrase(plan.channels, plan.territories)} — every use separately. Nothing is cleared until it is.`
      : status === "stale"
        ? `The last check (${allowed} of ${total} uses allowed) was for an earlier version. Check again before review.`
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
              {issues.map((i, n) => (
                <span key={i.key} className={i.outcome === "DENY" ? "text-status-blocked" : "text-status-review"}>
                  {n > 0 && <span className="px-1.5 text-ink-muted">·</span>}
                  {i.topic}
                </span>
              ))}
            </p>
          )}
        </div>
      </div>
      {demo && <DemoPolicyNote label={demo} />}
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
function Actions({
  goal,
  busy,
  disabled,
  stale,
  restricted,
  searched,
  onCheck,
  onFindAnotherWay,
  onSubmit,
  onOpenReview,
}: Props & { stale: boolean; restricted: boolean; searched: boolean }) {
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
        {stale ? "Check again" : "Check rights"}
        <ArrowRightIcon />
      </Button>
    );

  if (goal.reviewStatus !== "NOT_SUBMITTED")
    return (
      <Button size="lg" variant={goal.reviewStatus === "PENDING" ? "default" : "outline"} className={primary} onClick={onOpenReview}>
        {goal.reviewStatus === "PENDING" ? "Open review" : "View audit receipt"} <ArrowRightIcon />
      </Button>
    );

  if (restricted && !searched)
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <Button size="lg" className={primary} disabled={disabled} onClick={onFindAnotherWay}>
          {busy === "alternatives" ? <Loader2Icon className="animate-spin" /> : <RouteIcon />} Find another way
        </Button>
        {goal.canSubmit && (
          <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onSubmit}>
            Submit for review as is
          </Button>
        )}
        {recheckLink}
      </div>
    );

  if (goal.canSubmit && restricted)
    // NEEDS_REVIEW after a search: submitting as is stays possible, but the recovery above is the main path.
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onSubmit}>
          {busy === "submit" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Submit for review as is
        </Button>
        {recheckLink}
      </div>
    );

  if (goal.canSubmit)
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <Button size="lg" className={primary} disabled={disabled} onClick={onSubmit}>
          {busy === "submit" ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Submit for review
        </Button>
        {recheckLink}
      </div>
    );

  // Restricted, searched, nothing submittable: the recovery above holds the next step.
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-meta text-ink-muted">{goal.licenceGap ? "Review stays locked until a licence covers this market." : "Review unlocks once a use is allowed."}</p>
      {recheckLink}
    </div>
  );
}

/**
 * Recovery — "Find another way". Keeps the objective; explains what blocks it; offers what can actually fix
 * it: independently re-checked replacement moments (CLIP), the licensed subset of the campaign (CAMPAIGN), or —
 * when no licensed path exists — the honest next step, with nothing that looks executable.
 */
function Recovery({ goal, busy, disabled, onUseAlternative, onApplyRemedy, onEditGoal }: Props) {
  const alts = goal.alternatives!;
  const blocker = goal.blocker ?? alts.blocker;
  const plan = goal.campaign?.plan ?? goal.run.plan;
  const fictional = demoLabel(goal.rights) !== null;
  const firstUsable = alts.candidates.find((c) => c.verdict !== "BLOCKED" && goal.campaign?.key !== c.key)?.key;

  return (
    <div className="space-y-5">
      <div>
        <Eyebrow>Another way</Eyebrow>
        <h3 className="mt-2 font-display text-[1.0625rem] font-medium text-ink">Same goal: {goal.run.objective.summary}</h3>
        <p className="mt-1.5 text-small text-ink-muted">
          {blocker.scope === "CLIP"
            ? "The problem is this clip, not the campaign. PULSE searched the club's footage for comparable moments and checked each one on its own."
            : blocker.explanation}
        </p>
      </div>

      {blocker.scope === "CAMPAIGN" ? (
        goal.licenceGap ? (
          <div className="space-y-3">
            <p className="text-small text-ink-soft">
              A different clip would hit the same restriction, and no use inside this goal is licensed. PULSE won&apos;t move the campaign to other markets.
            </p>
            <p className="flex items-start gap-2 rounded-lg bg-obsidian px-4 py-3 text-small text-ink ring-1 ring-line ring-inset">
              <ArrowRightIcon className="mt-0.5 size-3.5 shrink-0 text-ink-muted" aria-hidden />
              <span>
                Next step: request a licence for {[...goal.licenceGap.territories.map(country), ...goal.licenceGap.platforms.map((p) => CHANNEL_LABEL[p] ?? p)].join(", ")} from the
                rights holder.
              </span>
            </p>
            <Button variant="ghost" size="sm" className="text-ink-muted" onClick={onEditGoal}>
              Change the goal instead
            </Button>
          </div>
        ) : goal.remedy ? (
          <div className="space-y-4">
            <p className="text-small text-ink-soft">A different clip would hit the same restriction. Keep the markets the campaign is licensed for:</p>
            {goal.remedy.territories && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Markets">
                {plan.territories.map((t) => {
                  const kept = goal.remedy!.territories!.includes(t);
                  return (
                    <li
                      key={t}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-meta ring-1 ring-inset",
                        kept ? "text-ink ring-line-strong" : "text-ink-muted line-through decoration-ink-muted/60 ring-line",
                      )}
                    >
                      {kept ? <CheckIcon className="size-3" aria-hidden /> : <XIcon className="size-3" aria-hidden />}
                      <span>{country(t)}</span>
                      <span className="sr-only">{kept ? "(kept)" : "(dropped)"}</span>
                    </li>
                  );
                })}
              </ul>
            )}
            <Button size="lg" className="h-10 w-full rounded-lg px-4 font-semibold whitespace-normal sm:w-auto" disabled={disabled} onClick={onApplyRemedy}>
              {busy === "remedy" && <Loader2Icon className="animate-spin" />}
              {goal.remedy.label}
            </Button>
            <p className="text-meta text-ink-muted">Saves a new campaign version. Then check it again — every use is re-decided from scratch.</p>
          </div>
        ) : (
          <p className="text-small text-ink-soft">{blocker.suggestion ?? "Change the market, channel, type of use or date of this campaign, then check rights again."}</p>
        )
      ) : blocker.scope === "NONE" ? (
        <p className="text-small text-ink-muted">Nothing to route around for this campaign.</p>
      ) : alts.candidates.length === 0 ? (
        <p className="text-small text-ink-soft">
          No replacement found for “{alts.query}” in the club&apos;s library. PULSE never fills the gap with invented clips.
          {blocker.suggestion && ` ${blocker.suggestion}`}
        </p>
      ) : (
        <div>
          <p className="text-meta text-ink-muted">
            {alts.candidates.length} replacement{alts.candidates.length === 1 ? "" : "s"} found for “{alts.query}”, each checked for {usesPhrase(plan.channels, plan.territories)}.
          </p>
          <ul className="mt-2 divide-y divide-line">
            {alts.candidates.map((c, i) => (
              <li key={c.key}>
                <Reveal delay={0.06 * i}>
                  <AltRow
                    alt={c}
                    fictional={fictional}
                    primary={c.key === firstUsable}
                    inUse={goal.campaign?.key === c.key}
                    loading={busy === `alt:${c.key}`}
                    disabled={disabled}
                    onUse={() => onUseAlternative(c.key)}
                  />
                </Reveal>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function AltRow({
  alt,
  fictional,
  primary,
  inUse,
  loading,
  disabled,
  onUse,
}: {
  alt: AlternativeCandidate;
  fictional: boolean;
  primary: boolean;
  inUse: boolean;
  loading: boolean;
  disabled: boolean;
  onUse: () => void;
}) {
  const findings = alt.reasons.flatMap((r) => reasonFinding({ ...r, scoreplayMediaId: alt.segment.scoreplayMediaId }, { fictional }) ?? []);
  const issues = groupIssues([{ channel: "", territory: "", findings }]);
  const blocked = alt.verdict === "BLOCKED";
  return (
    <div className="flex gap-4 py-4">
      <MomentPreview
        key={alt.key}
        size="thumb"
        className="w-20 shrink-0 self-start sm:w-24"
        source={{
          title: alt.title,
          scoreplayAssetId: alt.segment.scoreplayMediaId,
          thumbnailUrl: alt.thumbnailUrl ?? alt.hit.thumbnailUrl,
          start: alt.segment.start,
          end: alt.segment.end,
          preview: alt.preview,
          note: "No playable stream for this replacement.",
        }}
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p className="truncate text-small font-medium text-ink" title={alt.title}>
          {displayTitle(alt.title)}
        </p>
        <p className="tabular text-meta text-ink-muted">
          {segmentLabel(alt.segment.start, alt.segment.end, undefined)} · search rank {alt.hit.rank}
        </p>
        <StatusPill status={rightsStatus(alt.verdict, alt.clearance)} />
        {issues.length > 0 && (
          <details className="group/w text-meta text-ink-muted">
            <summary className="inline-flex cursor-pointer list-none items-center gap-1 hover:text-ink [&::-webkit-details-marker]:hidden">
              <ChevronRightIcon className="size-3 transition-transform group-open/w:rotate-90" aria-hidden /> Why
            </summary>
            <ul className="mt-2 divide-y divide-line">
              {issues.map((i) => (
                <IssueBlock key={i.key} issue={i} compact />
              ))}
            </ul>
          </details>
        )}
      </div>
      <div className="shrink-0 self-start">
        {inUse ? (
          <span className="inline-flex h-8 items-center gap-1 text-meta text-ink-soft">
            <CheckIcon className="size-3.5" aria-hidden /> In campaign
          </span>
        ) : blocked ? (
          <span className="inline-flex h-8 items-center text-meta text-ink-muted">Also restricted</span>
        ) : (
          <Button size="sm" variant={primary ? "default" : "outline"} className={cn("h-8 px-3 font-semibold", !primary && "bg-transparent")} disabled={disabled} onClick={onUse}>
            {loading && <Loader2Icon className="animate-spin" />}
            Use instead
          </Button>
        )}
      </div>
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
