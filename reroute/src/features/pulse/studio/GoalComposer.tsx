"use client";

import { useMemo, useRef } from "react";
import { ArrowRightIcon, CornerDownLeftIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CLUBS } from "../clubs";
import { goalPlan, parseMatch } from "../goal-intents";
import { parseObjective } from "../objective-parser";
import type { Club } from "../types";
import { Eyebrow, StagedProgress, country, usageWord, type Stage } from "./parts";

/** Example objectives by business intent. Each fills the field with a full sentence the parser understands. */
const EXAMPLES: Record<Club, { label: string; goal: string }[]> = {
  tottenham: [
    { label: "Sponsor a goal moment", goal: "Promote our partner AIA with Solanke's late goal for UK fans" },
    { label: "Sell merchandise", goal: "Promote Tottenham merchandise to UK supporters" },
    { label: "Sell tickets", goal: "Sell tickets for the next home game" },
    { label: "Activate a sponsor", goal: "Promote Kraken with fans in the UK" },
    { label: "Grow engagement", goal: "Maximize global engagement from the Manchester United game" },
    { label: "Sell jerseys", goal: "Sell Tottenham jerseys to UK fans" },
    { label: "Grow UK followers", goal: "Get more followers in the UK" },
    { label: "Open a new market", goal: "Sell more Spurs jerseys in Mexico" },
  ],
  spurs: [{ label: "Sell jerseys abroad", goal: "Sell Spurs jerseys in Mexico using the best moments from the Kings game" }],
};

/**
 * The first screen: one question, one field, one action. While typing, the same deterministic parser the
 * server uses shows what PULSE understood (goal, market, type of use) — unknowns are said, never guessed.
 * The club is chosen in the header (ClubSwitcher); `club` picks the examples and the plan PULSE reads.
 */
export function GoalComposer({
  text,
  onText,
  club,
  busy,
  progress,
  onSubmit,
  aside,
}: {
  text: string;
  onText: (t: string) => void;
  club: Club;
  busy: boolean;
  progress?: { stages: Stage[]; note?: string };
  onSubmit: () => void;
  /** Secondary navigation shown under the composer (e.g. back to the current campaign). */
  aside?: React.ReactNode;
}) {
  const field = useRef<HTMLTextAreaElement>(null);
  const ready = text.trim().length >= 3;
  const understood = useMemo(() => (ready ? understand(text, club) : null), [ready, text, club]);

  return (
    <section aria-labelledby="goal-title" className="mx-auto flex w-full max-w-[860px] flex-1 flex-col justify-center px-5 py-14 sm:px-8 sm:py-20">
      <Eyebrow>New campaign · {CLUBS[club].label}</Eyebrow>
      <h1 id="goal-title" className="mt-5 font-display text-display font-medium text-balance text-ink">
        What are we trying to achieve?
      </h1>
      <p className="mt-4 max-w-xl text-body text-ink-muted">
        Describe a business goal. PULSE finds the club moments that fit it, drafts the campaign and checks the rights before anyone posts.
      </p>

      <form
        className={cn(
          "mt-10 rounded-xl bg-surface ring-1 ring-line-strong transition-shadow duration-200 ring-inset",
          "focus-within:ring-2 focus-within:ring-signal/70",
        )}
        onSubmit={(e) => {
          e.preventDefault();
          if (ready && !busy) onSubmit();
        }}
      >
        <label htmlFor="goal-text" className="sr-only">
          Business objective
        </label>
        <textarea
          id="goal-text"
          ref={field}
          value={text}
          autoFocus
          onChange={(e) => onText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          rows={2}
          maxLength={280}
          disabled={busy}
          placeholder={EXAMPLES[club][0].goal}
          aria-describedby="goal-understood"
          className="block w-full resize-none bg-transparent px-5 pt-5 pb-3 text-[1.25rem] leading-snug text-ink outline-none placeholder:text-ink-muted/60 disabled:opacity-70 sm:text-[1.375rem]"
        />
        <div className="flex flex-col gap-3 border-t border-line px-5 py-3 sm:flex-row sm:items-center">
          <p id="goal-understood" aria-live="polite" className="min-h-5 min-w-0 flex-1 text-small text-ink-muted">
            {understood ? (
              <>
                <span className="sr-only">PULSE reads: </span>
                {understood.map((part, i) => (
                  <span key={part.text} className={cn(part.unknown ? "text-status-review" : "text-ink-soft")}>
                    {i > 0 && <span className="px-1.5 text-ink-muted">·</span>}
                    {part.text}
                  </span>
                ))}
              </>
            ) : (
              "Goal, market and product in one sentence."
            )}
          </p>
          <div className="flex items-center gap-3">
            <span className="hidden items-center gap-1 text-meta text-ink-muted sm:inline-flex" aria-hidden>
              <CornerDownLeftIcon className="size-3" /> to search
            </span>
            <Button type="submit" size="lg" disabled={!ready || busy} className="h-10 w-full rounded-lg px-4 text-[0.9375rem] font-semibold sm:w-auto">
              {busy ? <Loader2Icon className="animate-spin" /> : null}
              {busy ? "Finding opportunities" : "Find opportunities"}
              {!busy && <ArrowRightIcon />}
            </Button>
          </div>
        </div>
      </form>

      {busy && progress ? (
        <StagedProgress stages={progress.stages} note={progress.note} className="mt-6 max-w-md" />
      ) : (
        <div className="mt-6 flex flex-wrap items-center gap-2" role="group" aria-label="Example objectives">
          {EXAMPLES[club].map((ex) => (
            <button
              key={ex.label}
              type="button"
              title={ex.goal}
              aria-pressed={text === ex.goal}
              onClick={() => {
                onText(ex.goal);
                field.current?.focus();
              }}
              className={cn(
                "rounded-full px-3 py-1.5 text-small ring-1 transition-colors ring-inset",
                text === ex.goal ? "bg-surface-raised text-ink ring-line-strong" : "text-ink-muted ring-line hover:text-ink hover:ring-line-strong",
              )}
            >
              {ex.label}
            </button>
          ))}
        </div>
      )}
      {aside && <div className="mt-10">{aside}</div>}
    </section>
  );
}

/** What the parser reads from the sentence, in the order a marketer thinks: goal, where, how it's used. */
function understand(text: string, club: Club): { text: string; unknown?: boolean }[] {
  const o = parseObjective(text);
  const plan = goalPlan(o, club);
  const match = parseMatch(text);
  return [
    o.product ? { text: o.product.label } : { text: "Goal type not recognised", unknown: true },
    o.scope === "MARKET" && o.market
      ? { text: o.market.label }
      : o.scope === "GLOBAL"
        ? { text: `Global · ${plan.territories.length} markets` }
        : { text: `No market — ${country(plan.territories[0])} by default`, unknown: true },
    { text: `${usageWord(plan.usage)} use`.replace(/^\w/, (c) => c.toUpperCase()) },
    ...(match ? [{ text: `v ${match}` }] : []),
  ];
}
