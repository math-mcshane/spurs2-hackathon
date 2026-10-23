"use client";

import { useEffect, useRef } from "react";
import { PencilLineIcon } from "lucide-react";
import { CONTAINER } from "@/components/pulse/shell";
import { cn } from "@/lib/utils";
import { CLUBS } from "../clubs";
import type { GoalView } from "../types";
import { ProvenanceTag, channelList, country, usageWord } from "./parts";

export type View = "goal" | "discover" | "campaign" | "review";

/** The four screens (URL `step`). The header shows them as six journey phases. */
export const VIEWS: View[] = ["goal", "discover", "campaign", "review"];

type Phase = { key: string; label: string; view: View; anchor?: string };

/** The journey as the user lives it. Campaign, Compliance and Resolution share the campaign screen. */
const PHASES: Phase[] = [
  { key: "goal", label: "Goal", view: "goal" },
  { key: "media", label: "Opportunities", view: "discover" },
  { key: "campaign", label: "Campaign", view: "campaign" },
  { key: "compliance", label: "Compliance", view: "campaign", anchor: "lens-title" },
  { key: "resolution", label: "Resolution", view: "campaign", anchor: "resolution" },
  { key: "review", label: "Review", view: "review" },
];

/** Where the user is in the journey and which phases they have reached. */
function journey(goal: GoalView, view: View, reached: Record<View, boolean>): { phase: string; reached: Record<string, boolean> } {
  const checked = goal.rights.state !== "NOT_CHECKED";
  const resolving = !!goal.beforeAfter || (!!goal.recovery && goal.rights.current && goal.recovery.forEvaluationId === goal.rights.evaluationId);
  const phase =
    view === "goal" ? "goal" : view === "discover" ? "media" : view === "review" ? "review" : resolving ? "resolution" : checked ? "compliance" : "campaign";
  return {
    phase,
    reached: {
      goal: true,
      media: reached.discover,
      campaign: reached.campaign,
      compliance: reached.campaign && checked,
      resolution: reached.campaign && (!!goal.recovery || !!goal.beforeAfter),
      review: reached.review,
    },
  };
}

/** The six phases of the journey. Reached phases are links back; phases not reached yet are inert text. */
export function StepNav({ goal, view, reached, onView }: { goal: GoalView; view: View; reached: Record<View, boolean>; onView: (v: View, anchor?: string) => void }) {
  const { phase, reached: open } = journey(goal, view, reached);
  const list = useRef<HTMLOListElement>(null);
  // Phones scroll the phases horizontally: keep the current one in view.
  useEffect(() => {
    const ol = list.current;
    const el = ol?.querySelector<HTMLElement>("[aria-current=step]");
    if (ol && el) ol.scrollLeft = el.offsetLeft - (ol.clientWidth - el.offsetWidth) / 2;
  }, [phase]);
  return (
    <nav aria-label="Campaign steps">
      <ol ref={list} className="relative flex items-center gap-0.5 overflow-x-auto py-1 md:py-0">
        {PHASES.map((s, i) => {
          const current = s.key === phase;
          const canGo = open[s.key] && !current;
          return (
            <li key={s.key} className="shrink-0">
              <button
                type="button"
                disabled={!canGo}
                aria-current={current ? "step" : undefined}
                onClick={() => onView(s.view, s.anchor)}
                className={cn(
                  "relative flex h-10 items-center gap-2 rounded-md px-2 text-small transition-colors md:h-14",
                  current ? "text-ink" : open[s.key] ? "text-ink-muted hover:text-ink" : "text-ink-muted/45",
                  "disabled:cursor-default",
                )}
              >
                <span className={cn("tabular font-mono text-meta", current ? "text-signal" : "text-current")}>{i + 1}</span>
                {s.label}
                {current && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-signal" aria-hidden />}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * The business objective, pinned at the top of every step after the goal: what we're trying to achieve,
 * where, and the uses the rights engine is asked about. Unknowns are shown as such.
 */
export function ObjectiveBar({ goal, onEdit }: { goal: GoalView; onEdit: () => void }) {
  const o = goal.run.objective;
  const p = goal.campaign?.plan ?? goal.run.plan;
  const market = o.market ? o.market.label : o.scope === "GLOBAL" ? `Global · ${p.territories.length} markets` : `${country(p.territories[0])} (club home)`;
  return (
    <div className="border-b border-line">
      <div className={cn(CONTAINER, "flex flex-col gap-4 py-5 lg:flex-row lg:items-end lg:justify-between")}>
        <div className="min-w-0">
          <p className="text-eyebrow font-medium text-ink-muted uppercase">
            Objective · {CLUBS[goal.run.club].label}
          </p>
          <p className="mt-2 font-display text-title font-medium text-ink" title={`“${o.raw}”`}>
            {o.summary}
          </p>
        </div>
        <div className="flex flex-col gap-3 lg:items-end">
          <dl className="flex flex-wrap gap-x-6 gap-y-2 text-small">
            <Fact label="Market">{market}</Fact>
            <Fact label="Channels">{channelList(p.channels)}</Fact>
            <Fact label="Use">{usageWord(p.usage).replace(/^\w/, (ch) => ch.toUpperCase())}</Fact>
            {goal.run.match && <Fact label="Match">v {goal.run.match}</Fact>}
          </dl>
          <div className="flex items-center gap-4">
            {goal.dataOrigin && <ProvenanceTag origin={goal.dataOrigin} />}
            <button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 text-small text-ink-muted transition-colors hover:text-ink">
              <PencilLineIcon className="size-3.5" aria-hidden /> Change goal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}
