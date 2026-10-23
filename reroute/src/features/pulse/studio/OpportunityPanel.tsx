"use client";

import { ChevronRightIcon, Loader2Icon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GoalView, RecommendationView } from "../types";
import { clipTitle } from "./opportunity-copy";

export const PANEL_ID = "opportunity-panel";

/**
 * The selected clip, full width below the cards: its video on the left, the rights card (decision, fix, next action)
 * on the right and, collapsed, the campaign draft. Nothing renders until a clip is selected — the cards carry the action.
 */
export function OpportunityPanel({
  goal,
  open,
  opening,
  media,
  lens,
  brief,
}: {
  goal: GoalView;
  /** A campaign is open (selected and checked, or adopted from a correction). */
  open: boolean;
  /** The card being opened, while its selection runs. */
  opening: RecommendationView | undefined;
  media: React.ReactNode;
  lens: React.ReactNode;
  brief: React.ReactNode;
}) {
  if (!open || !goal.campaign) return null;
  return (
    <section id={PANEL_ID} aria-label="Selected clip" aria-busy={!!opening} className="scroll-mt-24 border-t border-line pt-10">
      {opening && (
        <p role="status" className="mb-6 inline-flex items-center gap-2 text-small text-ink-muted">
          <Loader2Icon className="size-4 animate-spin" aria-hidden /> Opening “{clipTitle(opening.candidate.title)}”…
        </p>
      )}

      <div className={cn("grid grid-cols-1 gap-x-10 gap-y-8 transition-opacity lg:grid-cols-12", opening && "pointer-events-none opacity-55")}>
        <div className="min-w-0 lg:sticky lg:top-20 lg:col-span-6 lg:self-start xl:col-span-7">{media}</div>
        <div className="min-w-0 lg:col-span-6 xl:col-span-5">{lens}</div>
      </div>

      <details className="group/brief mt-10 border-t border-line">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-4 text-small text-ink-soft transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
          <span>
            Campaign draft <span className="text-ink-muted">· copy, audience, link</span>
          </span>
          <ChevronRightIcon className="size-4 shrink-0 text-ink-muted transition-transform group-open/brief:rotate-90" aria-hidden />
        </summary>
        {brief}
      </details>
    </section>
  );
}
