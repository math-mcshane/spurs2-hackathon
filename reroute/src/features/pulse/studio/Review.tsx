"use client";

import { useState } from "react";
import { CheckIcon, Loader2Icon, LogInIcon, RefreshCwIcon, SendIcon, SendHorizonalIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/reroute/shared";
import { reviewApi, type ReviewerSession } from "@/components/reroute/reviewer";
import { cn } from "@/lib/utils";
import type { GoalView } from "../types";
import { CHANNEL_LABEL } from "./parts";

const STATUS_TEXT: Record<GoalView["reviewStatus"], { label: string; cls: string }> = {
  NOT_SUBMITTED: { label: "Not submitted", cls: "border-white/15 text-zinc-300" },
  PENDING: { label: "Waiting for a reviewer", cls: "border-amber-500/50 bg-amber-500/10 text-amber-200" },
  APPROVED: { label: "Approved by reviewer", cls: "border-emerald-500/50 bg-emerald-500/10 text-emerald-200" },
  REJECTED: { label: "Rejected by reviewer", cls: "border-red-500/50 bg-red-500/10 text-red-200" },
};

/** Why "Submit for review" is unavailable, in plain words. */
function submitBlockedReason(goal: GoalView): string {
  const r = goal.rights;
  if (r.state === "NOT_CHECKED") return "Check rights first.";
  if (!r.current) return "The campaign changed after the last check — check rights again.";
  if (r.state === "BLOCKED") return "REROUTE blocked this use. Find another way first.";
  return goal.nextStep;
}

/** Step 9: human review (reviewer identity comes from the signed-in session) and the publication gate. */
export function ReviewStage({
  goal,
  session,
  sessionError,
  onRetrySession,
  submitting,
  disabled,
  onSubmit,
  onSignIn,
  onReviewed,
}: {
  goal: GoalView;
  session: ReviewerSession | null;
  sessionError: unknown;
  onRetrySession: () => void;
  submitting: boolean;
  disabled: boolean;
  onSubmit: () => void;
  onSignIn: () => void;
  onReviewed: () => void;
}) {
  const [busy, setBusy] = useState<"APPROVED" | "REJECTED" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const status = STATUS_TEXT[goal.reviewStatus];
  const reviewer = session?.reviewer;

  async function review(decision: "APPROVED" | "REJECTED") {
    if (!goal.receiptId) return;
    setBusy(decision);
    setError(null);
    try {
      await reviewApi.review(goal.receiptId, decision);
      toast.success(decision === "APPROVED" ? "Approved — recorded on the audit receipt" : "Rejected — recorded on the audit receipt");
      onReviewed();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
      <div className="min-w-0 space-y-3 rounded-xl border border-white/10 bg-zinc-950/60 p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold text-zinc-50">Human review</h3>
          <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", status.cls)}>{status.label}</span>
        </div>

        {goal.reviewStatus === "NOT_SUBMITTED" ? (
          <>
            <p className="text-xs text-zinc-400">
              Submitting creates an audit receipt with REROUTE&apos;s verdict, the policy, the exact media and every channel × territory checked.
            </p>
            <Button size="lg" disabled={disabled || !goal.canSubmit} onClick={onSubmit} aria-describedby={goal.canSubmit ? undefined : "submit-why"}>
              {submitting ? <Loader2Icon className="animate-spin" /> : <SendIcon />} Submit for review
            </Button>
            {!goal.canSubmit && (
              <p id="submit-why" className="text-xs text-amber-200">
                {submitBlockedReason(goal)}
              </p>
            )}
          </>
        ) : goal.reviewStatus === "PENDING" ? (
          !session && sessionError !== null ? (
            <div className="space-y-2">
              <ErrorState error={sessionError} />
              <Button size="sm" variant="outline" onClick={onRetrySession}>
                <RefreshCwIcon /> Retry
              </Button>
            </div>
          ) : !session ? (
            <p className="flex items-center gap-2 text-xs text-zinc-400">
              <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Checking reviewer sign-in…
            </p>
          ) : !session.enabled ? (
            <p className="text-xs text-amber-200">Reviewer sign-in is not configured on this server, so nobody can approve or reject yet.</p>
          ) : !reviewer ? (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">A rights reviewer must sign in to approve or reject. Their name is recorded on the receipt.</p>
              <Button onClick={onSignIn}>
                <LogInIcon /> Sign in as reviewer
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-zinc-400">
                Reviewing as <strong className="text-zinc-100">{reviewer.name}</strong>. Read the verdict and the receipt below before deciding.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button className="bg-emerald-600 text-white hover:bg-emerald-500" disabled={disabled || busy !== null} onClick={() => void review("APPROVED")}>
                  {busy === "APPROVED" ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Approve
                </Button>
                <Button variant="destructive" disabled={disabled || busy !== null} onClick={() => void review("REJECTED")}>
                  {busy === "REJECTED" ? <Loader2Icon className="animate-spin" /> : <XIcon />} Reject
                </Button>
              </div>
            </div>
          )
        ) : (
          <p className="text-xs text-zinc-400">The decision is recorded on the audit receipt below.</p>
        )}
        {error !== null && <ErrorState error={error} />}
      </div>

      <PublishGate goal={goal} />
    </div>
  );
}

/** Publish is enabled only when `publishable` (verified clearance AND human approval). PULSE itself never posts. */
function PublishGate({ goal }: { goal: GoalView }) {
  const c = goal.campaign;
  return (
    <div className={cn("space-y-3 rounded-xl border p-4 text-sm", goal.publishable ? "border-emerald-500/50 bg-emerald-500/[0.07]" : "border-white/10 bg-zinc-950/60")}>
      <h3 className="font-semibold text-zinc-50">Publish</h3>
      <Button
        size="lg"
        className={cn(goal.publishable && "bg-emerald-600 text-white hover:bg-emerald-500")}
        disabled={!goal.publishable || !c}
        aria-describedby="publish-why"
        onClick={async () => {
          if (!c) return;
          const text = c.channels.map((ch) => `${CHANNEL_LABEL[ch.channel] ?? ch.channel}\n${ch.copy}`).join("\n\n");
          await navigator.clipboard.writeText(`${text}\n\n${c.cta.destination?.url ?? ""}`.trim());
          toast.success("Approved post copied — schedule it in the club's own publishing tool");
        }}
      >
        <SendHorizonalIcon /> {goal.publishable ? "Publish — copy approved post" : "Publish (locked)"}
      </Button>
      <p id="publish-why" className={cn("text-xs", goal.publishable ? "text-emerald-200" : "text-zinc-400")}>
        {goal.publishNote}
      </p>
    </div>
  );
}
