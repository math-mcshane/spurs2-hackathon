"use client";

import { Loader2Icon, PencilLineIcon, RefreshCwIcon, RotateCwIcon } from "lucide-react";
import { Reveal } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GoalView, OpportunityPreflight, RecommendationView } from "../types";
import { DECISION } from "./ComplianceEditor";
import { MomentPreview, recommendationSource } from "./MomentPreview";
import { clipTitle, metadataOnly, relevanceLine } from "./opportunity-copy";
import { PhotoSuggestions } from "./PhotoSuggestions";
import type { PreflightApi, PreflightState } from "./preflight-state";
import { Eyebrow, Notice, PolicyContext, StatusPill, rightsStatus, type Status } from "./parts";

type Props = {
  goal: GoalView;
  preflight: PreflightApi;
  /** Any Studio action running (disables CTAs). */
  busy: boolean;
  /** Card whose selection is running (spinner on its CTA). */
  loadingKey: string | null;
  /** Card whose campaign is open in the panel below the cards. */
  openKey: string | null;
  /** Open the card in the panel (select + rights check). */
  onSelect: (rec: RecommendationView) => void;
  onSearchAgain: () => void;
  onEditGoal: () => void;
  /** The selected clip's panel, full width below the cards. */
  detail: React.ReactNode;
};

/**
 * Step 2 · Rights & Compliance: the strongest real clips for the goal as a row of cards (picture, title, one line of
 * relevance, one compliance state, "Select clip"), and the selected clip's panel below them — its video, the rights
 * decision, the fix and the campaign draft. Evidence lives behind "Why? View details" in the panel.
 */
export function OpportunityStudio({ goal, preflight, busy, loadingKey, openKey, onSelect, onSearchAgain, onEditGoal, detail }: Props) {
  const recs = goal.recommendations;
  const states = recs.map((r) => preflight.get(r));
  const illustrative = goal.policy ? !goal.policy.verified : states.some((s) => s?.status === "done" && s.result.illustrative);

  if (!recs.length) {
    const photosOnly = goal.photos.length > 0;
    return (
      <section aria-labelledby="discover-title" className="space-y-6">
        <div>
          <Eyebrow>Rights &amp; Compliance</Eyebrow>
          <h1 id="discover-title" className="mt-3 font-display text-title font-medium text-ink">
            {photosOnly ? "Photo opportunities for this goal" : "No clip found for this goal"}
          </h1>
        </div>
        <Notice
          tone={photosOnly ? "info" : "warning"}
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
          {photosOnly ? "The club photos below fit the goal on ScorePlay metadata alone." : "PULSE never fills the gap with invented clips."}
        </Notice>
        {openKey && detail}
        <PhotoSuggestions photos={goal.photos} note={goal.photosNote} standalone={photosOnly} />
      </section>
    );
  }

  const opening = loadingKey ? recs.find((r) => r.key === loadingKey) : undefined;
  return (
    <section aria-labelledby="discover-title">
      <div className="max-w-3xl">
        <Eyebrow>Rights &amp; Compliance</Eyebrow>
        <h1 id="discover-title" className="mt-3 font-display text-title font-medium text-balance text-ink">
          Find the right footage. Make it usable.
        </h1>
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-small text-ink-muted">
          <p>Real club footage for your goal. Pick a clip — PULSE checks it against the selected rules.</p>
          {/* One policy chip on screen: once a clip is open, its rights card carries it. */}
          {illustrative && !openKey && <PolicyContext verified={false} sourceType={goal.policy?.sourceType} />}
        </div>
        {metadataOnly(recs[0]) && (
          <p className="mt-2 text-meta text-ink-muted">
            Ranked on ScorePlay tags only — which brands are on screen is unknown until the clip is analysed, and the rights check treats it as unknown.
          </p>
        )}
      </div>

      <ol id="opportunity-rail" aria-label="Clips" className="mt-8 grid scroll-mt-24 grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {recs.map((rec, i) => (
          <li key={rec.key} className="min-w-0">
            <Reveal delay={0.06 * i} className="h-full">
              <Opportunity
                goal={goal}
                rec={rec}
                top={i === 0}
                state={states[i]}
                open={openKey === rec.key}
                busy={busy}
                loading={loadingKey === rec.key}
                onSelect={() => onSelect(rec)}
                onRetry={() => preflight.retry(rec)}
              />
            </Reveal>
          </li>
        ))}
      </ol>

      {opening && !openKey && (
        <p role="status" className="mt-8 inline-flex items-center gap-2 text-small text-ink-soft">
          <Loader2Icon className="size-4 animate-spin" aria-hidden /> Opening “{clipTitle(opening.candidate.title)}”…
        </p>
      )}

      <div className="mt-12">{detail}</div>

      <PhotoSuggestions photos={goal.photos} note={goal.photosNote} />
    </section>
  );
}

function Opportunity({
  goal,
  rec,
  top,
  state,
  open,
  busy,
  loading,
  onSelect,
  onRetry,
}: {
  goal: GoalView;
  rec: RecommendationView;
  top: boolean;
  state: PreflightState | undefined;
  /** Its campaign is open in the panel. */
  open: boolean;
  busy: boolean;
  loading: boolean;
  onSelect: () => void;
  onRetry: () => void;
}) {
  const title = clipTitle(rec.candidate.title);
  const headingId = `opportunity-${rec.key.replace(/[^a-z0-9]+/gi, "-")}`;
  return (
    <article
      aria-labelledby={headingId}
      aria-current={open ? "true" : undefined}
      className={cn(
        "flex h-full flex-col gap-4 rounded-xl p-3 transition-[box-shadow,background-color] duration-200 ring-inset",
        open ? "bg-surface ring-2 ring-signal/80" : "ring-1 ring-line hover:ring-line-strong",
      )}
    >
      <MomentPreview key={rec.key} source={recommendationSource(rec)} size="compact" label={top ? "Top match" : undefined} />
      <div className="flex-1 space-y-1.5 px-1">
        <h2 id={headingId} className="font-display text-[1.0625rem] leading-snug font-medium text-balance text-ink" title={rec.candidate.title}>
          {title}
        </h2>
        <p className="line-clamp-2 text-small text-ink-muted">{relevanceLine(goal, rec)}</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-1 pb-1">
        <div aria-live="polite" aria-atomic="true" className="min-w-0">
          {open && goal.rights.state !== "NOT_CHECKED" ? (
            <OpenState goal={goal} />
          ) : (
            <CardState state={state} rec={rec} onRetry={onRetry} />
          )}
        </div>
        {open ? (
          <span className="rounded-full bg-signal/15 px-2.5 py-1 text-meta font-medium text-signal">Selected</span>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={onSelect} aria-label={`Select: ${title}`} className="h-9 rounded-lg bg-transparent px-3.5 font-semibold">
            {loading && <Loader2Icon className="animate-spin" aria-hidden />}
            Select clip
          </Button>
        )}
      </div>
    </article>
  );
}

function verdictStatus(p: OpportunityPreflight): Status {
  if (p.verdict === "ALLOWED") return p.illustrative || p.clearance !== "VERIFIED" ? "provisional" : "clear";
  return p.verdict === "BLOCKED" ? "blocked" : "review";
}

/** The card's compliance state: REROUTE's early check of this clip, in one pill. */
function CardState({ state, rec, onRetry }: { state: PreflightState | undefined; rec: RecommendationView; onRetry: () => void }) {
  if (state === undefined) {
    const recorded = rightsStatus(rec.rights.state, rec.rights.clearance);
    return recorded === "idle" ? (
      <span className="text-meta text-ink-muted">Checked when selected</span>
    ) : (
      <StatusPill status={recorded} label={DECISION[recorded]} />
    );
  }
  if (state.status === "checking")
    return (
      <span className="inline-flex items-center gap-1.5 text-meta font-medium text-status-idle">
        <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Checking rights…
      </span>
    );
  if (state.status === "unavailable")
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" title={state.message}>
        <StatusPill status="idle" label="Check unavailable" />
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1 rounded text-meta text-ink-soft underline-offset-2 hover:text-ink hover:underline focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
        >
          <RotateCwIcon className="size-3" aria-hidden /> Retry
        </button>
      </span>
    );
  const status = verdictStatus(state.result);
  return <StatusPill status={status} label={DECISION[status]} />;
}

/** The open card's state: the recorded rights check of the campaign (not the early check). */
function OpenState({ goal }: { goal: GoalView }) {
  const status: Status = goal.rights.current ? rightsStatus(goal.rights.state, goal.rights.clearance) : "stale";
  return <StatusPill status={status} label={DECISION[status]} />;
}
