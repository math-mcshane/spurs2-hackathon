"use client";

import { ArrowRightIcon, ChevronRightIcon, Loader2Icon, MousePointerClickIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GoalView, RecommendationView } from "../types";
import { opportunityHeadline } from "./opportunity-copy";
import { Eyebrow, displayTitle } from "./parts";

export const PANEL_ID = "opportunity-panel";

/**
 * The focused detail of the selected opportunity inside Step 2: its media, the full rights decision (with "Find a
 * way to use it", apply and re-check) and, secondary, the campaign draft. Once the campaign is submitted, the one
 * way forward is "Continue to Review & Audit". Without a selection it says what selecting does.
 */
export function OpportunityPanel({
  goal,
  open,
  opening,
  lead,
  busy,
  onSelectLead,
  onContinue,
  media,
  lens,
  brief,
}: {
  goal: GoalView;
  /** A campaign is open (selected and checked, or adopted from a correction). */
  open: boolean;
  /** The card being opened, while its selection runs. */
  opening: RecommendationView | undefined;
  /** The top match, offered when nothing is open yet. */
  lead: RecommendationView | undefined;
  busy: boolean;
  onSelectLead: () => void;
  onContinue: () => void;
  media: React.ReactNode;
  lens: React.ReactNode;
  brief: React.ReactNode;
}) {
  if (!open || !goal.campaign) {
    return (
      <section
        id={PANEL_ID}
        aria-label="Selected opportunity"
        className="flex min-h-[22rem] scroll-mt-24 flex-col items-center justify-center gap-4 rounded-xl border border-dashed border-line-strong px-6 py-12 text-center"
      >
        {opening ? (
          <p role="status" className="inline-flex items-center gap-2 text-small text-ink-soft">
            <Loader2Icon className="size-4 animate-spin" aria-hidden /> Opening “{displayTitle(opening.candidate.title)}”…
          </p>
        ) : (
          <>
            <MousePointerClickIcon className="size-6 text-ink-muted" aria-hidden />
            <div className="max-w-md space-y-2">
              <h2 className="font-display text-headline font-medium text-ink">Select an opportunity</h2>
              <p className="text-small text-ink-muted">
                PULSE runs the full rights check here — every channel and market — and, when something is restricted, finds a way to use it. You stay on this
                step.
              </p>
            </div>
            {lead && (
              <Button size="lg" disabled={busy} onClick={onSelectLead} className="h-10 rounded-lg px-4 font-semibold">
                Select the top match <ArrowRightIcon aria-hidden />
              </Button>
            )}
          </>
        )}
      </section>
    );
  }

  const c = goal.campaign;
  const rec = goal.recommendations.find((r) => r.key === c.key);
  const submitted = !!goal.receiptId && goal.reviewStatus !== "NOT_SUBMITTED";
  return (
    <section id={PANEL_ID} aria-labelledby="panel-title" aria-busy={!!opening} className="scroll-mt-24">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <Eyebrow>{rec ? "Selected opportunity" : c.origin === "ALTERNATIVE" ? "Replacement moment" : "Campaign moment"} · rights for this campaign</Eyebrow>
          <h2 id="panel-title" className="mt-2 font-display text-headline font-medium text-balance text-ink">
            {rec ? opportunityHeadline(goal, rec) : displayTitle(c.media.title)}
          </h2>
        </div>
        {opening && (
          <p role="status" className="inline-flex items-center gap-2 text-small text-ink-muted">
            <Loader2Icon className="size-4 animate-spin" aria-hidden /> Opening “{displayTitle(opening.candidate.title)}”…
          </p>
        )}
      </div>

      {submitted && (
        <div role="status" className="mt-5 flex flex-col gap-3 rounded-xl bg-signal/10 px-5 py-4 ring-1 ring-signal/40 ring-inset sm:flex-row sm:items-center sm:justify-between">
          <p className="text-small text-ink">
            {goal.reviewStatus === "PENDING" ? "Submitted for human review — the audit receipt is recorded." : "A reviewer has decided — the audit receipt is recorded."}
          </p>
          <Button size="lg" onClick={onContinue} className="h-10 shrink-0 rounded-lg px-4 font-semibold">
            Continue to Review &amp; Audit <ArrowRightIcon aria-hidden />
          </Button>
        </div>
      )}

      <div className={cn("mt-6 grid grid-cols-1 gap-x-8 gap-y-8 transition-opacity xl:grid-cols-12", opening && "pointer-events-none opacity-55")}>
        <div className="min-w-0 xl:sticky xl:top-20 xl:col-span-5 xl:self-start">{media}</div>
        <div className="min-w-0 xl:col-span-7">{lens}</div>
      </div>

      <details className="group/brief mt-10 border-t border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-small text-ink-soft transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
          <span>
            Campaign draft · version {c.version} <span className="text-ink-muted">— hook, audience, channel copy, destination link</span>
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-ink-muted transition-transform group-open/brief:rotate-90" aria-hidden />
        </summary>
        {brief}
      </details>
    </section>
  );
}
