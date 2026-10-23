"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, ChevronRightIcon, ClipboardCopyIcon, Loader2Icon, LockKeyholeIcon, LogInIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import type { MediaRef } from "@/lib/contracts";
import { Reveal } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { ErrorState, tcRange, utc } from "@/components/reroute/shared";
import { reviewApi, type AuditedReceipt, type ReviewerSession } from "@/components/reroute/reviewer";
import { WritebackAction, WritebackLog } from "@/components/reroute/writeback-plan";
import { reasonFinding } from "../goal-view";
import type { GoalView } from "../types";
import { MomentPreview, recommendationSource } from "./MomentPreview";
import { CHANNEL_LABEL, Eyebrow, IssueBlock, PolicyContext, StatusPill, calmDemoLabel, country, displayTitle, groupIssues, rightsStatus, usageWord } from "./parts";

const METHOD_TEXT: Record<MediaRef["method"], string> = {
  AUTHORITATIVE_ID: "linked by ScorePlay id",
  FILENAME_DURATION: "linked by exact filename + duration",
  AMBIGUOUS: "ambiguous link — evidence not attached",
  UNMAPPED: "no TwelveLabs match — evidence not attached",
};

const REVIEW_HEADLINE: Record<GoalView["reviewStatus"], string> = {
  NOT_SUBMITTED: "Not submitted",
  PENDING: "Waiting for a reviewer",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

/**
 * Review: the human decision and its record. Left, the audit receipt as a document (decision, policy, uses,
 * media, reviewer, hash-chained trail). Right, the approval and the publication state — a locked publish is a
 * status, never a button — and the ScorePlay record (dry run by default).
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

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-12">
      <div className="min-w-0 lg:col-span-7">
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
      <aside className="min-w-0 space-y-6 lg:col-span-5">
        <div className="lg:sticky lg:top-20 lg:space-y-6">
          <Approval goal={goal} receipt={receipt} session={session} sessionError={sessionError} onRetrySession={onRetrySession} onSignIn={onSignIn} onReviewed={onChanged} />
          <section aria-labelledby="wb-title" className="mt-6 rounded-xl bg-surface ring-1 ring-line ring-inset lg:mt-0">
            <details className="group/wb">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-6 py-4 [&::-webkit-details-marker]:hidden">
                <span>
                  <span id="wb-title" className="block text-small font-medium text-ink">
                    ScorePlay record
                  </span>
                  <span className="block text-meta text-ink-muted">What would be written back to the asset · dry run</span>
                </span>
                <ChevronRightIcon className="size-4 shrink-0 text-ink-muted transition-transform group-open/wb:rotate-90" aria-hidden />
              </summary>
              <div className="space-y-4 px-6 pb-6">
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
      </aside>
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
  const c = goal.campaign;

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
    <section aria-labelledby="approval-title" className="overflow-hidden rounded-xl bg-surface ring-1 ring-line ring-inset">
      {c && (
        <div className="flex items-center gap-4 border-b border-line px-6 py-4">
          <MomentPreview
            size="thumb"
            className="w-16 shrink-0"
            source={
              goal.selected
                ? { ...recommendationSource(goal.selected), ...(goal.edit && { start: goal.edit.original.start, end: goal.edit.original.end, skip: goal.edit.removed }) }
                : {
                    title: c.media.title,
                    scoreplayAssetId: c.media.scoreplayAssetId,
                    start: goal.edit?.original.start ?? c.media.startSeconds,
                    end: goal.edit?.original.end ?? c.media.endSeconds,
                    note: "",
                  }
            }
          />
          <div className="min-w-0">
            <p className="truncate text-small font-medium text-ink">{displayTitle(c.media.title)}</p>
            <p className="text-meta text-ink-muted">
              Campaign version {c.version}
              {goal.edit && ` · Edited cut · ${goal.edit.executionLabel}`}
            </p>
          </div>
          <StatusPill status={rightsStatus(goal.rights.state, goal.rights.clearance)} className="ml-auto" />
        </div>
      )}

      <div className="space-y-5 px-6 py-6">
        <div>
          <Eyebrow>
            <span id="approval-title">Human review</span>
          </Eyebrow>
          <h2 className="mt-2 font-display text-headline font-medium text-ink">{REVIEW_HEADLINE[goal.reviewStatus]}</h2>
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
              <p className="text-small text-ink-soft">A named rights reviewer approves or rejects. Their name is recorded on the receipt.</p>
              <Button size="lg" className="h-10 rounded-lg px-4 font-semibold" onClick={onSignIn}>
                <LogInIcon /> Sign in as reviewer
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-small text-ink-soft">
                Reviewing as <span className="text-ink">{reviewer.name}</span>. Read the receipt before deciding — reviews are final.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="lg" className="h-10 rounded-lg px-4 font-semibold" disabled={busy !== null} onClick={() => void review("APPROVED")}>
                  {busy === "APPROVED" ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Approve
                </Button>
                <Button size="lg" variant="outline" className="h-10 rounded-lg bg-transparent px-4" disabled={busy !== null} onClick={() => void review("REJECTED")}>
                  {busy === "REJECTED" ? <Loader2Icon className="animate-spin" /> : <XIcon />} Reject
                </Button>
              </div>
            </div>
          ))}
        {error !== null && <ErrorState error={error} />}

        <Publish goal={goal} />
      </div>
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
