"use client";

import { useCallback, useEffect, useState } from "react";
import {
  ArrowRightIcon,
  CheckIcon,
  ChevronRightIcon,
  ClapperboardIcon,
  ClipboardCopyIcon,
  Loader2Icon,
  LockKeyholeIcon,
  LogInIcon,
  RefreshCwIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";
import type { MediaRef } from "@/lib/contracts";
import { Reveal } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { ErrorState, tcRange, utc } from "@/components/reroute/shared";
import { reviewApi, type AuditedReceipt, type ReviewerSession } from "@/components/reroute/reviewer";
import { WritebackAction, WritebackLog } from "@/components/reroute/writeback-plan";
import { reasonFinding } from "../goal-view";
import type { GoalView, RecoveryKind } from "../types";
import { MomentPreview, recommendationSource } from "./MomentPreview";
import {
  CHANNEL_LABEL,
  Eyebrow,
  IssueBlock,
  PolicyContext,
  StatusPill,
  calmDemoLabel,
  country,
  displayTitle,
  groupIssues,
  rightsStatus,
  usageWord,
  usesPhrase,
  type Status,
} from "./parts";

const METHOD_TEXT: Record<MediaRef["method"], string> = {
  AUTHORITATIVE_ID: "linked by ScorePlay id",
  FILENAME_DURATION: "linked by exact filename + duration",
  AMBIGUOUS: "ambiguous link — evidence not attached",
  UNMAPPED: "no TwelveLabs match — evidence not attached",
};

const REVIEW_HEADLINE: Record<GoalView["reviewStatus"], string> = {
  NOT_SUBMITTED: "Not submitted",
  PENDING: "Ready for your decision",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/** The rights result in the words of Step 2. */
const RESULT: Record<Status, string> = {
  idle: "Not checked",
  stale: "Needs a fresh check",
  clear: "Cleared",
  provisional: "Allowed under the selected rules",
  review: "Needs review",
  blocked: "Restriction found",
};

/** What a recovery change did, in plain words (same labels as the Step 2 fixes). */
const CHANGE: Record<RecoveryKind, string> = {
  TRIM: "Removed the restricted segment",
  SAFE_SECTION: "Used the clean section of the clip",
  REPLACE: "Used another clip",
  ADAPT_CAMPAIGN: "Changed the campaign markets",
  CHANGE_USAGE: "Changed the type of post",
  REQUEST_CLEARANCE: "Asked for clearance",
};

/**
 * Human Review: the final decision, not another dashboard. Left, the final clip or edit plan with the campaign and
 * what changed; right, the goal, the rights result under the selected rules and one approval action. The audit
 * receipt and the ScorePlay record (dry run) sit in disclosures below. A locked publish is a status, never a button.
 */
export function ReviewView({
  goal,
  session,
  sessionError,
  onRetrySession,
  onSignIn,
  onChanged,
}: {
  goal: GoalView;
  session: ReviewerSession | null;
  sessionError: unknown;
  onRetrySession: () => void;
  onSignIn: () => void;
  /** The receipt changed server-side (review, writeback): refresh the run. */
  onChanged: () => void;
}) {
  const receiptId = goal.receiptId!;
  const version = `${goal.reviewStatus}:${goal.writeback.status}:${goal.writeback.at ?? ""}`;
  const [receipt, setReceipt] = useState<AuditedReceipt | null>(null);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(() => {
    reviewApi.receipt(receiptId).then((r) => {
      setReceipt(r);
      setError(null);
    }, setError);
  }, [receiptId]);
  useEffect(load, [load, version]);

  const summary = "flex cursor-pointer list-none items-center justify-between gap-3 py-4 [&::-webkit-details-marker]:hidden";
  const chevron = "size-4 shrink-0 text-ink-muted transition-transform";

  return (
    <section aria-labelledby="review-title" className="space-y-10">
      <div>
        <Eyebrow>Human Review</Eyebrow>
        <h1 id="review-title" className="mt-3 font-display text-title font-medium text-balance text-ink">
          Review the final plan. Make the call.
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-7">{goal.campaign && <FinalPlan goal={goal} campaign={goal.campaign} />}</div>
        <aside className="min-w-0 lg:col-span-5">
          <div className="lg:sticky lg:top-20">
            <Approval goal={goal} receipt={receipt} session={session} sessionError={sessionError} onRetrySession={onRetrySession} onSignIn={onSignIn} onReviewed={onChanged} />
          </div>
        </aside>
      </div>

      <div className="divide-y divide-line border-y border-line">
        <details className="group/rc">
          <summary className={summary}>
            <span>
              <span className="block text-small font-medium text-ink">Audit receipt</span>
              <span className="block text-meta text-ink-muted">
                Decision record, policy, uses, reviewer and hash-chained trail{receipt ? ` · #${receipt.id.slice(0, 8)}` : ""}
              </span>
            </span>
            <ChevronRightIcon className={`${chevron} group-open/rc:rotate-90`} aria-hidden />
          </summary>
          <div className="pb-6">
            {receipt ? (
              <Reveal>
                <ReceiptDocument
                  receipt={receipt}
                  sourceType={goal.policy?.sourceType}
                  titles={goal.campaign ? { [goal.campaign.media.scoreplayAssetId]: displayTitle(goal.campaign.media.title) } : {}}
                />
              </Reveal>
            ) : error !== null ? (
              <div className="space-y-3">
                <ErrorState error={error} />
                <Button size="sm" variant="outline" onClick={load}>
                  <RefreshCwIcon /> Retry
                </Button>
              </div>
            ) : (
              <p role="status" className="flex items-center gap-2 text-small text-ink-muted">
                <Loader2Icon className="size-4 animate-spin" aria-hidden /> Loading the audit receipt…
              </p>
            )}
          </div>
        </details>
        <section aria-labelledby="wb-title">
          <details className="group/wb">
            <summary className={summary}>
              <span>
                <span id="wb-title" className="block text-small font-medium text-ink">
                  ScorePlay record · dry run
                </span>
                <span className="block text-meta text-ink-muted">What would be written back to the asset — nothing is written</span>
              </span>
              <ChevronRightIcon className={`${chevron} group-open/wb:rotate-90`} aria-hidden />
            </summary>
            <div className="max-w-2xl space-y-4 pb-6">
              <WritebackAction
                // The dry run quotes the review status: re-plan it once the reviewer decides.
                key={goal.reviewStatus}
                receiptId={receiptId}
                session={session}
                onSignIn={onSignIn}
                onDone={(r) => {
                  setReceipt((prev) => (prev ? { ...prev, ...r.receipt, audit: prev.audit } : prev));
                  onChanged();
                }}
              />
              {receipt && (
                <div className="space-y-1.5 border-t border-line pt-3">
                  <p className="text-meta text-ink-muted">Attempts on this receipt</p>
                  <WritebackLog entries={receipt.writeback} />
                </div>
              )}
            </div>
          </details>
        </section>
      </div>
    </section>
  );
}

type Campaign = NonNullable<GoalView["campaign"]>;

/** The final clip (an edit plan plays with its cuts skipped), the campaign line and what changed on the way. */
function FinalPlan({ goal, campaign: c }: { goal: GoalView; campaign: Campaign }) {
  const edit = goal.edit;
  const ba = goal.beforeAfter;
  const plan = c.plan;
  const len = c.media.endSeconds - c.media.startSeconds;
  const before = ba && rightsStatus(ba.before.verdict);
  const after = ba?.after && rightsStatus(ba.after.verdict, ba.after.clearance);
  return (
    <div className="space-y-6">
      <MomentPreview
        size="stage"
        label={edit ? "Edit plan" : "Final clip"}
        source={
          goal.selected
            ? { ...recommendationSource(goal.selected), ...(edit && { start: edit.original.start, end: edit.original.end, skip: edit.removed }) }
            : {
                title: c.media.title,
                scoreplayAssetId: c.media.scoreplayAssetId,
                start: edit?.original.start ?? c.media.startSeconds,
                end: edit?.original.end ?? c.media.endSeconds,
                note: "No playable stream is available for this clip.",
              }
        }
      />
      <div>
        <h2 className="font-display text-headline font-medium text-ink first-letter:uppercase" title={c.media.title}>
          {displayTitle(c.media.title)}
        </h2>
        <p className="tabular mt-1.5 text-small text-ink-muted">
          {edit ? `Edited cut · ${edit.resultDurationSec.toFixed(1)} s of ${edit.originalDurationSec.toFixed(1)} s` : `${len.toFixed(1)} s clip`} ·{" "}
          {usesPhrase(plan.channels, plan.territories)} · {usageWord(plan.usage)} post
        </p>
      </div>

      <blockquote className="border-l-2 border-signal/60 pl-4 font-display text-[1.375rem] leading-snug font-medium text-ink">“{c.creative.hook}”</blockquote>

      <div className="space-y-2 border-t border-line pt-5">
        <h3 className="text-small font-medium text-ink-muted">Changes made</h3>
        {ba ? (
          <div className="space-y-2">
            <p className="text-body text-ink">
              {CHANGE[ba.kind]} <span className="text-ink-muted">— {ba.title}</span>
            </p>
            {before && (
              <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-small">
                <StatusPill status={before} label={RESULT[before]} />
                <ArrowRightIcon className="size-3.5 text-ink-muted" aria-label="then" />
                {after && ba.after ? (
                  <StatusPill status={after} label={`${RESULT[after]} · ${ba.after.allowedUses} of ${ba.after.totalUses} uses`} />
                ) : (
                  <span className="text-meta text-ink-muted">not re-checked</span>
                )}
              </p>
            )}
            {edit && (
              <p className="inline-flex items-center gap-1.5 text-meta text-ink-soft">
                <ClapperboardIcon className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
                {edit.executionLabel} — playback skips {edit.removed.map((r) => tcRange(r.start, r.end)).join(", ")}
              </p>
            )}
          </div>
        ) : (
          <p className="text-small text-ink-soft">None — the clip as selected.</p>
        )}
      </div>
    </div>
  );
}

function Approval({
  goal,
  receipt,
  session,
  sessionError,
  onRetrySession,
  onSignIn,
  onReviewed,
}: {
  goal: GoalView;
  receipt: AuditedReceipt | null;
  session: ReviewerSession | null;
  sessionError: unknown;
  onRetrySession: () => void;
  onSignIn: () => void;
  onReviewed: () => void;
}) {
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const reviewer = session?.reviewer;
  const last = receipt?.reviews.at(-1);
  const r = goal.rights;
  const status = rightsStatus(r.state, r.clearance);
  const allowed = r.perIntent.filter((p) => p.verdict === "ALLOWED").length;

  async function review(decision: "APPROVED" | "REJECTED") {
    setBusy(decision);
    setError(null);
    try {
      await reviewApi.review(goal.receiptId!, decision);
      toast.success(decision === "APPROVED" ? "Approved — recorded on the audit receipt" : "Rejected — recorded on the audit receipt");
      onReviewed();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby="approval-title" className="space-y-6 rounded-xl bg-surface px-6 py-6 ring-1 ring-line ring-inset">
      <dl className="space-y-5">
        <div>
          <dt className="text-eyebrow font-medium text-ink-muted uppercase">Goal</dt>
          <dd className="mt-1.5 text-body text-ink">{goal.run.objective.summary}</dd>
        </div>
        <div>
          <dt className="text-eyebrow font-medium text-ink-muted uppercase">Rights</dt>
          <dd className="mt-1.5 space-y-1.5">
            <p className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <StatusPill status={status} label={RESULT[status]} className="text-small" />
              {r.perIntent.length > 0 && (
                <span className="tabular text-meta text-ink-muted">
                  {allowed} of {r.perIntent.length} uses
                </span>
              )}
            </p>
            {goal.policy && (
              <div className="flex flex-wrap items-center gap-2 text-meta text-ink-muted">
                {goal.policy.title}
                <PolicyContext verified={goal.policy.verified} sourceType={goal.policy.sourceType} />
              </div>
            )}
          </dd>
        </div>
      </dl>

      <div className="space-y-4 border-t border-line pt-5">
        <div>
          <h2 id="approval-title" className="font-display text-headline font-medium text-ink">
            {REVIEW_HEADLINE[goal.reviewStatus]}
          </h2>
          {last && (
            <p className="mt-1.5 text-small text-ink-muted">
              {last.status === "APPROVED" ? "Approved" : "Rejected"} by {last.reviewer} · {utc(last.at)}
            </p>
          )}
        </div>

        {goal.reviewStatus === "PENDING" &&
          (!session && sessionError !== null ? (
            <div className="space-y-2">
              <ErrorState error={sessionError} />
              <Button size="sm" variant="outline" onClick={onRetrySession}>
                <RefreshCwIcon /> Retry
              </Button>
            </div>
          ) : !session ? (
            <p className="flex items-center gap-2 text-small text-ink-muted">
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Checking reviewer sign-in…
            </p>
          ) : !session.enabled ? (
            <p className="text-small text-ink-soft">Reviewer sign-in is not configured on this server, so nobody can approve or reject yet.</p>
          ) : !reviewer ? (
            <div className="space-y-3">
              <p className="text-small text-ink-soft">A named rights reviewer makes the call. Their name goes on the audit receipt.</p>
              <Button size="lg" className="h-11 rounded-lg px-5 font-semibold" onClick={onSignIn}>
                <LogInIcon /> Sign in as reviewer
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Button size="lg" className="h-11 rounded-lg px-6 text-[0.9375rem] font-semibold" disabled={busy !== null} onClick={() => void review("APPROVED")}>
                  {busy === "APPROVED" ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Approve
                </Button>
                <Button size="lg" variant="outline" className="h-11 rounded-lg bg-transparent px-5" disabled={busy !== null} onClick={() => void review("REJECTED")}>
                  {busy === "REJECTED" ? <Loader2Icon className="animate-spin" /> : <XIcon />} Reject
                </Button>
              </div>
              <p className="text-meta text-ink-muted">
                Reviewing as <span className="text-ink-soft">{reviewer.name}</span>. The decision is final and recorded on the audit receipt.
              </p>
            </div>
          ))}
        {error !== null && <ErrorState error={error} />}
      </div>

      <Publish goal={goal} />
    </section>
  );
}

/** Publication needs verified clearance AND approval (`publishable`). PULSE never posts; it hands over the approved copy. */
function Publish({ goal }: { goal: GoalView }) {
  const c = goal.campaign;
  if (goal.publishable && c)
    return (
      <div className="space-y-2 border-t border-line pt-5">
        <Button
          size="lg"
          className="h-10 rounded-lg px-4 font-semibold"
          onClick={async () => {
            const text = c.channels.map((ch) => `${CHANNEL_LABEL[ch.channel] ?? ch.channel}\n${ch.copy}`).join("\n\n");
            await navigator.clipboard.writeText(`${text}\n\n${c.cta.destination?.url ?? ""}`.trim());
            toast.success("Approved post copied — schedule it in the club's own publishing tool");
          }}
        >
          <ClipboardCopyIcon /> Copy approved post
        </Button>
        <p className="text-meta text-ink-muted">{calmDemoLabel(goal.publishNote)}</p>
      </div>
    );
  return (
    <div className="flex items-start gap-3 border-t border-line pt-5">
      <LockKeyholeIcon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
      <div>
        <p className="text-small font-medium text-ink">Publishing locked</p>
        <p className="mt-0.5 text-small text-ink-muted">{calmDemoLabel(goal.publishNote)}</p>
      </div>
    </div>
  );
}

/** The audit receipt, read as a document. Identifiers and the hash chain sit in a disclosure at the end. */
function ReceiptDocument({
  receipt,
  sourceType,
  titles,
}: {
  receipt: AuditedReceipt;
  /** How the run's package reached the library (preset, sample mapping, upload). */
  sourceType?: NonNullable<GoalView["policy"]>["sourceType"];
  /** ScorePlay id → display title, when known. */
  titles: Record<string, string>;
}) {
  const d = receipt.decision;
  const uses = receipt.intents?.length ? receipt.intents : [receipt.intent];
  const issues = groupIssues([{ channel: "", territory: "", findings: d.reasons.flatMap((r) => reasonFinding(r, { evidence: d.evidence, fictional: d.policyFictional }) ?? []) }]);
  const status = rightsStatus(d.verdict, d.clearance);
  return (
    <article aria-label={`Audit receipt ${receipt.id}`} className="overflow-hidden rounded-xl bg-surface ring-1 ring-line ring-inset">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-line px-7 pt-6 pb-5">
        <div>
          <Eyebrow>Audit receipt</Eyebrow>
          <h2 className="mt-2 font-display text-title font-medium text-ink">Rights decision record</h2>
        </div>
        <p className="font-mono text-meta text-ink-muted" title={receipt.id}>
          #{receipt.id.slice(0, 8)}
        </p>
      </header>

      <dl className="grid grid-cols-1 gap-x-6 gap-y-5 px-7 py-6 text-small sm:grid-cols-[8.5rem_minmax(0,1fr)] [&>dd]:min-w-0 [&>dd]:break-words [&>dt]:text-ink-muted">
        <dt>Decision</dt>
        <dd className="space-y-1">
          <StatusPill status={status} />
          <p className="text-ink-soft">
            For {uses.length} use{uses.length === 1 ? "" : "s"} · {receipt.edit.segments.length} segment{receipt.edit.segments.length === 1 ? "" : "s"}
          </p>
        </dd>
        <dt>Policy</dt>
        <dd className="text-ink">
          {d.policyId} <span className="text-ink-muted">v{d.policyVersion}</span>
          <PolicyContext verified={!d.policyFictional} sourceType={sourceType} className="mt-1 block" />
        </dd>
        <dt>Uses covered</dt>
        <dd className="space-y-0.5 text-ink">
          {uses.map((u) => (
            <span key={`${u.platform}-${u.territory}-${u.usage}`} className="block">
              {CHANNEL_LABEL[u.platform] ?? u.platform} · {country(u.territory)} · <span className="text-ink-muted">{usageWord(u.usage)}</span>
            </span>
          ))}
        </dd>
        <dt>Media</dt>
        <dd className="space-y-0.5">
          {receipt.edit.segments.map((s, n) => (
            <span key={n} className="tabular block text-ink">
              {titles[s.scoreplayMediaId] ?? `ScorePlay ${s.scoreplayMediaId}`}{" "}
              <span className="text-ink-muted">
                · {tcRange(s.start, s.end)}
                {titles[s.scoreplayMediaId] && ` · ScorePlay ${s.scoreplayMediaId}`}
              </span>
            </span>
          ))}
        </dd>
        <dt>Human review</dt>
        <dd className="text-ink">
          {receipt.reviews.length === 0
            ? "Pending"
            : receipt.reviews.map((r, n) => (
                <span key={n} className="block">
                  {r.status === "APPROVED" ? "Approved" : "Rejected"} by {r.reviewer} <span className="text-ink-muted">· {utc(r.at)}</span>
                </span>
              ))}
        </dd>
        <dt>Recorded</dt>
        <dd className="text-ink-soft">
          Decided {utc(d.evaluatedAt)} · receipt {utc(receipt.createdAt)}
        </dd>
      </dl>

      {issues.length > 0 && (
        <div className="border-t border-line px-7 py-6">
          <p className="mb-4 text-small font-medium text-ink">Restrictions recorded</p>
          <ul className="divide-y divide-line">
            {issues.map((i) => (
              <IssueBlock key={i.key} issue={i} compact />
            ))}
          </ul>
        </div>
      )}

      <details className="group/t border-t border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-7 py-4 text-small text-ink-soft hover:text-ink [&::-webkit-details-marker]:hidden">
          Identifiers and audit trail · {receipt.audit.length} hash-chained event{receipt.audit.length === 1 ? "" : "s"}
          <ChevronRightIcon className="size-4 shrink-0 text-ink-muted transition-transform group-open/t:rotate-90" aria-hidden />
        </summary>
        <div className="space-y-4 px-7 pb-6 font-mono text-meta text-ink-muted">
          <ul className="space-y-1 break-all">
            <li>receipt {receipt.id}</li>
            {receipt.campaignId && <li>campaign {receipt.campaignId}</li>}
            {receipt.media.map((m, n) => (
              <li key={n}>
                {m.scoreplayMediaId ?? "—"} ↔ TwelveLabs {m.twelvelabsVideoId ?? "—"} · {METHOD_TEXT[m.method]}
                {m.match?.durationDeltaSec !== undefined && ` (Δ ${m.match.durationDeltaSec.toFixed(3)} s)`}
              </li>
            ))}
          </ul>
          <ol className="space-y-1">
            {receipt.audit.map((e) => (
              <li key={e.id} className="break-all">
                {utc(e.at)} · {e.type} · {e.actor} · <span className="text-ink-muted/70">{e.hash.slice(0, 12)}</span>
              </li>
            ))}
          </ol>
        </div>
      </details>
    </article>
  );
}
