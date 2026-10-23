"use client";

import { ArrowRightIcon, ChevronRightIcon, Loader2Icon, PencilLineIcon, RefreshCwIcon } from "lucide-react";
import { Reveal } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CLUBS } from "../clubs";
import type { GoalView, RecommendationView } from "../types";
import { MomentPreview, recommendationSource, segmentLabel } from "./MomentPreview";
import { PhotoSuggestions } from "./PhotoSuggestions";
import { Eyebrow, Notice, StatusPill, displayTitle, rightsStatus } from "./parts";

type Props = {
  goal: GoalView;
  busy: boolean;
  /** Key of the moment whose selection is running. */
  loadingKey: string | null;
  onChoose: (rec: RecommendationView) => void;
  onSearchAgain: () => void;
  onEditGoal: () => void;
};

/**
 * Discover: the three strongest real moments for the objective, composed editorially — one lead moment and
 * two alternatives — with one action each. Retrieval ranks and scoring live in each moment's detail.
 */
export function MomentGallery({ goal, busy, loadingKey, onChoose, onSearchAgain, onEditGoal }: Props) {
  const recs = goal.recommendations;
  const [lead, ...rest] = recs;
  const context = [CLUBS[goal.run.club].label, goal.run.match && `v ${goal.run.match}`].filter(Boolean).join(" ");

  if (!lead) {
    return (
      <section aria-labelledby="discover-title" className="space-y-6">
        <h1 id="discover-title" className="font-display text-title font-medium text-ink">
          No moment found for this goal
        </h1>
        <Notice
          tone="warning"
          actions={
            <>
              <Button variant="outline" size="sm" disabled={busy} onClick={onSearchAgain}>
                <RefreshCwIcon /> Search again
              </Button>
              <Button variant="ghost" size="sm" onClick={onEditGoal}>
                <PencilLineIcon /> Change goal
              </Button>
            </>
          }
        >
          {goal.run.search.message}{" "}
          {goal.run.search.status === "NOT_INDEXED"
            ? "This club's footage is not indexed for video search yet."
            : goal.run.search.status === "UNAVAILABLE"
              ? "Video search is unavailable right now."
              : "Try a different product, market or match."}{" "}
          PULSE never fills the gap with invented clips.
        </Notice>
      </section>
    );
  }

  return (
    <section aria-labelledby="discover-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Eyebrow>
            Discover · {recs.length} of {goal.run.library.videos} club videos
          </Eyebrow>
          <h1 id="discover-title" className="mt-3 font-display text-title font-medium text-ink">
            The strongest moments for this goal
          </h1>
        </div>
        <p className="max-w-sm text-small text-ink-muted">
          {goal.run.playerFilter ? (
            <>
              Searched only the {goal.run.playerFilter.videos} videos ScorePlay tags with <span className="text-ink">{goal.run.playerFilter.requested}</span>, the
              player your goal names.{" "}
            </>
          ) : null}
          Real footage from the club library, located to the second. Choose one to build the campaign.
        </p>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-12 lg:grid-cols-12">
        <Reveal className="lg:col-span-7">
          <Moment rec={lead} index={1} lead context={context} {...pick(goal, lead, busy, loadingKey, onChoose)} />
        </Reveal>
        <div className="flex flex-col gap-10 lg:col-span-5 lg:border-l lg:border-line lg:pl-10">
          {rest.map((rec, i) => (
            <Reveal key={rec.key} delay={0.08 * (i + 1)}>
              <Moment rec={rec} index={i + 2} context={context} {...pick(goal, rec, busy, loadingKey, onChoose)} />
            </Reveal>
          ))}
        </div>
      </div>

      <PhotoSuggestions photos={goal.photos} note={goal.photosNote} />
    </section>
  );
}

function pick(goal: GoalView, rec: RecommendationView, busy: boolean, loadingKey: string | null, onChoose: (rec: RecommendationView) => void) {
  // The automatic first draft doesn't count as the user's choice: its moment still reads "Build campaign".
  const chosen = goal.campaign?.key === rec.key && goal.campaign.origin !== "PROPOSAL";
  return { inCampaign: chosen, busy, loading: loadingKey === rec.key, onChoose: () => onChoose(rec) };
}

function Moment({
  rec,
  index,
  lead = false,
  context,
  inCampaign,
  busy,
  loading,
  onChoose,
}: {
  rec: RecommendationView;
  index: number;
  lead?: boolean;
  context: string;
  inCampaign: boolean;
  busy: boolean;
  loading: boolean;
  onChoose: () => void;
}) {
  const c = rec.candidate;
  const span = segmentLabel(c.startSeconds ?? 0, c.endSeconds, c.durationSec);
  const status = rightsStatus(rec.rights.state, rec.rights.clearance);
  const label = `Moment ${String(index).padStart(2, "0")}`;
  return (
    <article aria-label={`${label}: ${displayTitle(c.title)}`} className={cn("group flex flex-col", lead ? "gap-6" : "gap-4")}>
      <MomentPreview key={rec.key} source={recommendationSource(rec)} size={lead ? "lead" : "compact"} label={lead ? `${label} · Recommended` : label} />
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className={cn("font-display font-medium text-ink", lead ? "text-headline" : "text-[1.0625rem] leading-snug")} title={c.title}>
            {displayTitle(c.title)}
          </h2>
          <p className="tabular mt-1.5 text-small text-ink-muted">
            {span}
            <span className="px-1.5">·</span>
            {[context, rec.season].filter(Boolean).join(" · ")}
          </p>
        </div>
        {status !== "idle" && <StatusPill status={status} className="mt-1" />}
      </div>
      {lead ? (
        <p className="max-w-2xl text-body text-ink-soft">{rec.why.opportunity}</p>
      ) : (
        <p className="text-small text-ink-soft">
          <span className="text-ink-muted">Shows </span>
          {rec.matches.map((m) => m.label.toLowerCase()).join(" · ")}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button
          size="lg"
          variant={lead || inCampaign ? "default" : "outline"}
          disabled={busy}
          onClick={onChoose}
          className={cn("h-10 rounded-lg px-4 font-semibold", !lead && !inCampaign && "bg-transparent")}
        >
          {loading && <Loader2Icon className="animate-spin" />}
          {inCampaign ? "Continue with this moment" : lead ? "Build campaign" : "Use this moment"}
          {!loading && <ArrowRightIcon />}
        </Button>
        <SearchDetail rec={rec} />
      </div>
    </article>
  );
}

/** Why the search ranked this moment: what it matched and how it was scored. Collapsed by default. */
function SearchDetail({ rec }: { rec: RecommendationView }) {
  return (
    <details className="group/d min-w-0 text-small text-ink-muted">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 transition-transform group-open/d:rotate-90" aria-hidden /> Why this moment
      </summary>
      <div className="mt-3 space-y-2 border-l border-line pl-3">
        <p className="text-ink-soft">{rec.why.media}</p>
        <p>{rec.why.action}</p>
        <ul className="space-y-0.5 text-meta">
          {rec.matches.map((m) => (
            <li key={m.intent}>
              Matched “{m.label}” · search rank {m.rank}
            </li>
          ))}
          <li className="tabular">Score {rec.score.toFixed(2)}</li>
        </ul>
      </div>
    </details>
  );
}
