"use client";

import { ArrowRightIcon, ChevronRightIcon, FileSearchIcon, Loader2Icon, RefreshCwIcon, ScaleIcon, SendIcon, WrenchIcon } from "lucide-react";
import { Reveal, Swap } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { utc } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import type { GoalView, RecommendationView } from "../types";
import { BeforeAfterPanel, ComplianceEditor, DECISION, momentSpan } from "./ComplianceEditor";
import { fixHint, issueSentence, metadataOnly, spanLabel } from "./opportunity-copy";
import {
  CHANNEL_LABEL,
  PolicyContext,
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
  PENDING: "Sent for human review · waiting for a reviewer",
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
 * The rights card — "Can I use this clip for this campaign?": one decision, one plain sentence about the problem,
 * one next action. A restricted clip offers "Fix this clip" (the Compliance Editor opens inside the card); after a
 * revised plan is applied the card shows it before/after. The rules sit in one quiet line; everything that backs the
 * decision (sponsor check, observed vs rule, every use, search evidence) is behind "Why? View details".
 */
export function RightsLens(props: Props) {
  const { goal, busy, disabled, progress } = props;
  const r = goal.rights;
  const checked = r.state !== "NOT_CHECKED";
  const stale = checked && !r.current;
  const status: Status = stale ? "stale" : rightsStatus(r.state, r.clearance);
  const restricted = r.current && (r.state === "BLOCKED" || r.state === "NEEDS_REVIEW");
  const submitted = goal.reviewStatus !== "NOT_SUBMITTED";
  /** Recovery options exist only for the latest evaluation: a stale search is never shown or usable. */
  const recovery = goal.recovery && r.current && !submitted && goal.recovery.forEvaluationId === r.evaluationId ? goal.recovery : undefined;
  const applyingId = busy?.startsWith("apply:") ? busy.slice(6) : null;
  const issues = r.current ? groupIssues(r.perIntent) : [];
  const recheck = busy === "rights" || busy === "policy";

  return (
    <section aria-labelledby="lens-title" aria-busy={busy !== null} className="rounded-xl bg-surface ring-1 ring-line ring-inset">
      <h2 id="lens-title" className="sr-only">
        Rights
      </h2>
      <div className="space-y-6 px-6 py-6">
        <Swap id={recheck ? "progress" : `${r.evaluationId ?? "none"}:${status}`}>
          {recheck && progress ? (
            <StagedProgress stages={progress.stages} note={progress.note} className="py-2" />
          ) : (
            <Decision goal={goal} status={status} issues={issues} hint={!!restricted && !recovery && !submitted && busy !== "recovery"} />
          )}
        </Swap>

        {goal.beforeAfter && !recovery && !recheck && (
          <Reveal className="border-t border-line pt-6">
            <BeforeAfterPanel beforeAfter={goal.beforeAfter} chosen={momentSpan(goal, goal.beforeAfter.before.key)} totalNow={r.perIntent.length || undefined} />
          </Reveal>
        )}

        {recovery && !recheck ? (
          <Reveal className="border-t border-line pt-6">
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
          <StagedProgress stages={progress.stages} note={progress.note} />
        ) : (
          !recheck && <Actions {...props} stale={stale} restricted={!!restricted} />
        )}
        {busy === "submit" && progress && <StagedProgress stages={progress.stages} note={progress.note} />}

        <PolicyRow goal={goal} disabled={disabled || submitted} onSetPolicy={props.onSetPolicy} />
      </div>

      {checked && !recheck && <Details goal={goal} issues={issues} stale={stale} deskHref={props.deskHref} />}
    </section>
  );
}

/** The decision, then — when restricted — the problem in one sentence and what "Fix this clip" will try. */
function Decision({ goal, status, issues, hint }: { goal: GoalView; status: Status; issues: Issue[]; hint: boolean }) {
  const r = goal.rights;
  const plan = goal.campaign?.plan ?? goal.run.plan;
  const allowed = r.perIntent.filter((p) => p.verdict === "ALLOWED").length;
  const restricted = status === "blocked" || status === "review";
  const sentence = restricted ? issueSentence(goal, issues) : undefined;
  const sub =
    status === "idle"
      ? `Each use is checked separately: ${usesPhrase(plan.channels, plan.territories)}.`
      : status === "stale"
        ? "The campaign or its rules changed after the last check. Check again before review."
        : status === "clear" || status === "provisional"
          ? `Under the selected rules · ${allowed} of ${r.perIntent.length} uses`
          : undefined;
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <div className="flex items-start gap-4">
        <StatusMark status={status} />
        <div className="min-w-0 space-y-1.5">
          <p className="font-display text-headline font-medium text-ink">{DECISION[status]}</p>
          {sub && <p className="text-small text-ink-muted">{sub}</p>}
          {sentence && <p className="text-small text-ink">{sentence}</p>}
          {hint && (
            <p className="text-small text-ink-muted">
              <span className="text-ink-soft">Suggested fix:</span> {fixHint(goal, issues)}
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
      <Button size="lg" className={primary} onClick={onOpenReview}>
        Continue to Human Review <ArrowRightIcon />
      </Button>
    );

  if (restricted)
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-3">
        <Button size="lg" className={primary} disabled={disabled} onClick={onFindRecovery}>
          {busy === "recovery" ? <Loader2Icon className="animate-spin" /> : <WrenchIcon />} Fix this clip
        </Button>
        {goal.canSubmit && (
          <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onSubmit}>
            Send as is
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
      <p className="text-meta text-ink-muted">Human review unlocks once a use is allowed.</p>
      {recheckLink}
    </div>
  );
}

/** The rule package in one quiet line, its policy-context chip and the switch to another package. */
function PolicyRow({ goal, disabled, onSetPolicy }: { goal: GoalView; disabled: boolean; onSetPolicy: (packageId: string) => void }) {
  const p = goal.policy;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-4 text-meta text-ink-muted">
      <ScaleIcon className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0">
        Rules: <span className="text-ink-soft">{p ? p.title : "Club rights policy"}</span>
      </span>
      {p && <PolicyContext verified={p.verified} sourceType={p.sourceType} />}
      <div className="ml-auto">
        <PolicyPicker club={goal.run.club} value={p?.packageId} disabled={disabled} triggerLabel="Change rules" runId={goal.run.id} onChange={onSetPolicy} />
      </div>
    </div>
  );
}

/** Everything behind the decision, collapsed: sponsor check, observed vs rule, every use, when it was checked, why the clip was found. */
function Details({ goal, issues, stale, deskHref }: { goal: GoalView; issues: Issue[]; stale: boolean; deskHref: string }) {
  const r = goal.rights;
  const rec = goal.recommendations.find((x) => x.key === goal.campaign?.key);
  return (
    <details className="group/x border-t border-line">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-b-xl px-6 py-4 text-small text-ink-soft transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <span>
          Why? <span className="text-ink-muted">View details</span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-ink-muted transition-transform group-open/x:rotate-90" aria-hidden />
      </summary>
      <div className="space-y-7 px-6 pb-6">
        {goal.sponsorContext && <SponsorCheck goal={goal} sponsor={goal.sponsorContext} />}

        {issues.length > 0 && (
          <DetailBlock title={`What was found · ${issues.length} ${issues.length === 1 ? "issue" : "issues"}`}>
            <ul className="divide-y divide-line">
              {issues.map((issue) => (
                <IssueBlock key={issue.key} issue={issue} />
              ))}
            </ul>
          </DetailBlock>
        )}

        {r.perIntent.length > 0 && (
          <DetailBlock title={stale ? `Previous check · ${r.perIntent.length} uses` : `Every use · ${r.perIntent.length}`}>
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
            {r.evaluatedAt && (
              <p className="mt-3 text-meta text-ink-muted">
                {r.kind === "ALTERNATIVE" ? "Re-checked" : "Checked"} {utc(r.evaluatedAt)}
              </p>
            )}
          </DetailBlock>
        )}

        {rec && <SearchEvidence goal={goal} rec={rec} />}

        <a href={deskHref} className="inline-flex items-center gap-1.5 text-meta text-ink-muted underline-offset-4 hover:text-ink hover:underline">
          <FileSearchIcon className="size-3.5" aria-hidden /> Open frame-level evidence in the rights desk
        </a>
      </div>
    </details>
  );
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-eyebrow font-medium text-ink-muted uppercase">{title}</h3>
      {children}
    </section>
  );
}

/** Why the search found this clip: what it matched (with timecodes and ranks), how it was scored, what was searched. */
function SearchEvidence({ goal, rec }: { goal: GoalView; rec: RecommendationView }) {
  const filter = goal.run.playerFilter;
  return (
    <DetailBlock title="Why this clip">
      <div className="space-y-2 text-small text-ink-muted">
        <p className="text-ink-soft">{rec.why.media}</p>
        <p>{rec.why.opportunity}</p>
        <ul className="space-y-0.5 text-meta">
          {rec.matches.map((m) => (
            <li key={m.intent}>{metadataOnly(rec) ? `${m.label} (ScorePlay tag)` : `Matched “${m.label}” · ${spanLabel(m)} · search rank ${m.rank}`}</li>
          ))}
          {metadataOnly(rec) && (
            <>
              <li>
                Relevance {rec.breakdown.relevance}: {rec.breakdown.notes.relevance}
              </li>
              <li>
                Readiness {rec.breakdown.readiness}: {rec.breakdown.notes.readiness}
              </li>
              {rec.duplicates.length > 0 && <li>Also in ScorePlay as {rec.duplicates.length} other aspect-ratio version(s).</li>}
            </>
          )}
          <li className="tabular">Score {rec.score.toFixed(2)}</li>
          <li>
            {metadataOnly(rec) ? "Ranked on ScorePlay tags · not visually analysed" : "Machine-observed by TwelveLabs"} · {goal.recommendations.length} of{" "}
            {goal.run.library.videos} club videos proposed
            {filter ? ` · searched only the ${filter.videos} videos ScorePlay tags with ${filter.requested}` : ""}
          </li>
        </ul>
      </div>
    </DetailBlock>
  );
}

type Sponsor = NonNullable<GoalView["sponsorContext"]>;

const ROLE: Record<Sponsor["brands"][number]["role"], { text: string; tone: string }> = {
  TARGET: { text: "the partner this post promotes", tone: "text-ink-soft" },
  OTHER_PARTNER: { text: "official partner — allowed", tone: "text-ink-soft" },
  COMPETING_RESTRICTED: { text: "restricted for this use by the rule shown", tone: "text-status-blocked" },
  INCIDENTAL: { text: "incidental — allowed for this use", tone: "text-ink-soft" },
  CLUB_PARTNER: { text: "club partner, not named by these rules — reviewer confirms the contract, not a conflict", tone: "text-status-review" },
  UNKNOWN: { text: "no rule covers it — reviewer must confirm", tone: "text-status-review" },
};

const CERTAINTY: Record<Sponsor["brands"][number]["certainty"], string> = {
  AI_OBSERVATION: "AI observation",
  SCOREPLAY_TAG: "ScorePlay tag",
  REVIEWER: "Reviewer",
};

/**
 * Who the post promotes and every brand the check saw, as the rules treat each. A brand on screen is not a conflict
 * by itself: only the rule shown decides; partners are partners under the illustrative rules, never a real agreement.
 */
function SponsorCheck({ goal, sponsor }: { goal: GoalView; sponsor: Sponsor }) {
  const sponsored = (goal.campaign?.plan ?? goal.run.plan).usage === "SPONSORED";
  const t = sponsor.target;
  const others = sponsor.brands.filter((b) => b.role !== "TARGET");
  const onScreen = sponsor.brands.find((b) => b.role === "TARGET");
  const rules = [...new Set([t?.ruleId, ...sponsor.brands.map((b) => b.ruleId)].filter((x): x is string => !!x))];
  const evidence = [...new Set(sponsor.brands.map((b) => CERTAINTY[b.certainty]))];
  if (!sponsored && !t && others.length === 0) return null;
  return (
    <DetailBlock title="Sponsor check">
      <dl aria-label="Sponsor check" className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-small">
        {(sponsored || t) && (
          <>
            <dt className="text-ink-muted">Target sponsor</dt>
            <dd className="min-w-0">
              {!t ? (
                <span className="text-ink-soft">Not named in the goal — brand rules applied as written</span>
              ) : t.relationship === "PARTNER" ? (
                <span className="text-ink">
                  {t.name} <span className="text-ink-soft">— partner under {t.ruleId} (illustrative rules), not a conflict</span>
                </span>
              ) : (
                <span className="text-status-review">
                  {t.name} — {t.clubPartner ? `${t.clubPartner}; ` : ""}relationship not described by these illustrative rules · a reviewer must confirm
                </span>
              )}
              {onScreen && (
                <span className="block text-meta text-ink-muted">
                  On screen{onScreen.spans.length ? ` ${onScreen.spans.join(", ")}` : ""} · {CERTAINTY[onScreen.certainty]}
                </span>
              )}
            </dd>
          </>
        )}
        <dt className="text-ink-muted">Other brands on screen</dt>
        <dd className="min-w-0 space-y-1">
          {others.length === 0 ? (
            <span className="text-ink-soft">None seen</span>
          ) : (
            others.map((b) => (
              <p key={b.label}>
                <span className="text-ink">{b.name}</span> <span className={ROLE[b.role].tone}>— {ROLE[b.role].text}</span>
                {b.clubPartner && <span className="block text-meta text-ink-muted">{b.clubPartner} · club partner list</span>}
                <span className="block text-meta text-ink-muted">
                  {b.spans.length ? `${b.spans.join(", ")} · ` : ""}
                  {CERTAINTY[b.certainty]}
                  {b.ruleId ? ` · ${b.ruleId}` : ""}
                </span>
              </p>
            ))
          )}
        </dd>
        {rules.length > 0 && (
          <>
            <dt className="text-ink-muted">Applicable rule</dt>
            <dd className="min-w-0 break-words text-ink-soft">{rules.join(", ")}</dd>
          </>
        )}
        {evidence.length > 0 && (
          <>
            <dt className="text-ink-muted">Evidence</dt>
            <dd className="min-w-0 text-ink-soft">{evidence.join(" · ")}</dd>
          </>
        )}
      </dl>
    </DetailBlock>
  );
}
