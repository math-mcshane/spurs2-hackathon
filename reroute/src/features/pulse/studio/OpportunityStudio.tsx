"use client";

import { ArrowRightIcon, ChevronRightIcon, Loader2Icon, PencilLineIcon, RefreshCwIcon, RotateCwIcon, RouteIcon } from "lucide-react";
import { Reveal } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GoalView, OpportunityPreflight, RecommendationView } from "../types";
import { MomentPreview, recommendationSource, segmentLabel } from "./MomentPreview";
import {
  angleKicker,
  evidenceSource,
  matchEvidence,
  opportunityHeadline,
  postConcept,
  recommendationReason,
  resolutionHint,
  scorePlayContext,
  spanLabel,
  topFinding,
} from "./opportunity-copy";
import { PhotoSuggestions } from "./PhotoSuggestions";
import type { PreflightApi, PreflightState } from "./preflight-state";
import { Eyebrow, Notice, PolicyContext, STATUS, StatusPill, calmDemoLabel, displayTitle, rightsStatus, type Status } from "./parts";

type Props = {
  goal: GoalView;
  preflight: PreflightApi;
  /** Any Studio action running (disables CTAs). */
  busy: boolean;
  /** Card whose selection is running (spinner on its CTA). */
  loadingKey: string | null;
  /** Card whose campaign is open in the detail panel. */
  openKey: string | null;
  /** Open the card in the detail panel (select + rights check). */
  onSelect: (rec: RecommendationView) => void;
  /** Restricted card: open it and continue into "Find a way to use it". */
  onExplore: (rec: RecommendationView) => void;
  /** Bring the detail panel into view (the selected card is already open). */
  onShow: () => void;
  onSearchAgain: () => void;
  onEditGoal: () => void;
  /** The focused detail panel of the open opportunity, beside the cards. */
  detail: React.ReactNode;
};

/**
 * Step 2 · Opportunities & Rights: the strongest real moments for the objective as a compact rail of cards — media,
 * angle, why it fits, ScorePlay/TwelveLabs evidence and REROUTE's selection-time preflight — beside one detail panel
 * for the selected opportunity (its preview, full rights decision, "Find a way to use it" and the campaign draft).
 * Every card stays visible and selectable; switching never leaves the step.
 */
export function OpportunityStudio({ goal, preflight, busy, loadingKey, openKey, onSelect, onExplore, onShow, onSearchAgain, onEditGoal, detail }: Props) {
  const recs = goal.recommendations;
  const states = recs.map((r) => preflight.get(r));
  const checking = states.some((s) => s !== undefined);
  const illustrative = goal.policy ? !goal.policy.verified : states.some((s) => s?.status === "done" && s.result.illustrative);

  if (!recs.length) {
    const photosOnly = goal.photos.length > 0;
    return (
      <section aria-labelledby="discover-title" className="space-y-6">
        <div>
          <Eyebrow>Opportunities &amp; Rights</Eyebrow>
          <h1 id="discover-title" className="mt-3 font-display text-title font-medium text-ink">
            {photosOnly ? "Photo opportunities for this goal" : "No moment found for this goal"}
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

  return (
    <section aria-labelledby="discover-title">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <Eyebrow>
            Opportunities &amp; Rights · {recs.length} of {goal.run.library.videos} club videos
          </Eyebrow>
          <h1 id="discover-title" className="mt-3 font-display text-title font-medium text-balance text-ink">
            {recs.length === 1 ? "One opportunity for this goal" : `${recs.length === 2 ? "Two" : "Three"} opportunities for this goal`}
          </h1>
        </div>
        <div className="max-w-md space-y-2 text-small text-ink-muted">
          <p>
            {goal.run.playerFilter ? (
              <>
                Searched only the {goal.run.playerFilter.videos} videos ScorePlay tags with <span className="text-ink">{goal.run.playerFilter.requested}</span>.{" "}
              </>
            ) : null}
            Real club footage, located to the second. Select one to see its full rights decision beside the list.
          </p>
          {checking && (
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
              <span>Card rights: early check — the selected campaign gets the full, recorded check.</span>
              {illustrative && <PolicyContext verified={false} sourceType={goal.policy?.sourceType} />}
            </div>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-x-8 gap-y-10 lg:grid-cols-12">
        <div id="opportunity-rail" className="min-w-0 scroll-mt-24 lg:col-span-4 xl:col-span-3">
          <div className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:p-0.5 lg:pr-1.5 [scrollbar-width:thin]">
            <ol aria-label="Opportunities" className="space-y-4">
              {recs.map((rec, i) => (
                <li key={rec.key}>
                  <Reveal delay={0.06 * i}>
                    <Opportunity
                      goal={goal}
                      rec={rec}
                      rank={i}
                      state={preflight.get(rec)}
                      open={openKey === rec.key}
                      emphasize={i === 0 && !openKey}
                      busy={busy}
                      loading={loadingKey === rec.key}
                      onSelect={() => onSelect(rec)}
                      onExplore={() => onExplore(rec)}
                      onShow={onShow}
                      onRetry={() => preflight.retry(rec)}
                    />
                  </Reveal>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div className="min-w-0 lg:col-span-8 xl:col-span-9">{detail}</div>
      </div>

      <PhotoSuggestions photos={goal.photos} note={goal.photosNote} />
    </section>
  );
}

function Opportunity({
  goal,
  rec,
  rank,
  state,
  open,
  emphasize,
  busy,
  loading,
  onSelect,
  onExplore,
  onShow,
  onRetry,
}: {
  goal: GoalView;
  rec: RecommendationView;
  rank: number;
  state: PreflightState | undefined;
  /** Its campaign is open in the detail panel. */
  open: boolean;
  /** Nothing is open yet: the top match carries the primary action. */
  emphasize: boolean;
  busy: boolean;
  loading: boolean;
  onSelect: () => void;
  onExplore: () => void;
  onShow: () => void;
  onRetry: () => void;
}) {
  const c = rec.candidate;
  const title = displayTitle(c.title);
  const headingId = `opportunity-${rec.key.replace(/[^a-z0-9]+/gi, "-")}`;
  const blocked = state?.status === "done" && state.result.verdict === "BLOCKED";
  const context = scorePlayContext(goal, rec);
  const concept = postConcept(goal, rec);
  const btn = "h-9 rounded-lg px-3.5 font-semibold";
  return (
    <article
      aria-labelledby={headingId}
      aria-current={open ? "true" : undefined}
      className={cn(
        "flex flex-col gap-3.5 rounded-xl p-3.5 transition-[box-shadow,background-color] duration-200 ring-inset",
        open ? "bg-surface ring-2 ring-signal/80" : "ring-1 ring-line hover:ring-line-strong",
      )}
    >
      <MomentPreview key={rec.key} source={recommendationSource(rec)} size="compact" label={rank === 0 ? "Top match" : undefined} />

      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Eyebrow>{angleKicker(goal)}</Eyebrow>
          {open && <span className="rounded-full bg-signal/15 px-2 py-0.5 text-meta font-medium text-signal">Selected</span>}
        </div>
        <h2 id={headingId} className="font-display text-[1.0625rem] leading-snug font-medium text-balance text-ink">
          {opportunityHeadline(goal, rec)}
        </h2>
        <p className="tabular text-meta text-ink-muted">
          <span className="text-ink-soft" title={c.title}>
            {title}
          </span>
          <span className="px-1.5">·</span>
          {segmentLabel(c.startSeconds ?? 0, c.endSeconds, c.durationSec)}
          {context && (
            <>
              <span className="px-1.5">·</span>
              {context}
            </>
          )}
        </p>
      </div>

      <div className="space-y-1">
        <p className="line-clamp-4 text-small text-ink-soft">
          <span className="text-ink">Proposed post. </span>
          {concept.cut} {concept.action}
        </p>
        <p className="text-small text-ink-muted">
          <span className="text-ink-soft">Why it fits the goal: </span>
          {recommendationReason(goal, rec)}
        </p>
        <p className="tabular text-meta text-ink-muted">
          {evidenceSource(rec)}
          {rec.matches.length > 0 && <> · {matchEvidence(rec)}</>}
        </p>
      </div>

      {open && goal.rights.current && goal.rights.state !== "NOT_CHECKED" ? <Recorded goal={goal} /> : <Compliance state={state} rec={rec} featured={false} onRetry={onRetry} />}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {open ? (
          <Button size="sm" variant="ghost" className="-ml-2 text-ink-soft" onClick={onShow} aria-label={`Show details: ${title}`}>
            Details in the panel <ArrowRightIcon aria-hidden />
          </Button>
        ) : (
          <>
            {blocked && (
              <Button size="sm" disabled={busy} onClick={onExplore} aria-label={`Find a way to use it: ${title}`} className={btn}>
                {loading ? <Loader2Icon className="animate-spin" aria-hidden /> : <RouteIcon aria-hidden />}
                Find a way to use it
              </Button>
            )}
            <Button
              size="sm"
              variant={emphasize && !blocked ? "default" : "outline"}
              disabled={busy}
              onClick={onSelect}
              aria-label={`Select: ${title}`}
              className={cn(btn, !(emphasize && !blocked) && "bg-transparent")}
            >
              {loading && !blocked && <Loader2Icon className="animate-spin" aria-hidden />}
              Select
            </Button>
          </>
        )}
        <SearchDetail rec={rec} />
      </div>
    </article>
  );
}

/** The open card's line: the recorded rights check shown in full in the panel (not the early preflight). */
function Recorded({ goal }: { goal: GoalView }) {
  const r = goal.rights;
  const allowed = r.perIntent.filter((p) => p.verdict === "ALLOWED").length;
  const status = rightsStatus(r.state, r.clearance);
  return (
    <div aria-live="polite" aria-atomic="true" className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-t border-line pt-3">
      <StatusPill status={status} label={`Rights check · ${STATUS[status].label}`} />
      {r.perIntent.length > 0 && (
        <span className="tabular text-meta text-ink-muted">
          {allowed} of {r.perIntent.length} uses allowed
        </span>
      )}
    </div>
  );
}

/** The card's rights line: REROUTE's preflight in plain words, never a final clearance. Announced when it changes. */
function Compliance({ state, rec, featured, onRetry }: { state: PreflightState | undefined; rec: RecommendationView; featured: boolean; onRetry: () => void }) {
  return (
    <div aria-live="polite" aria-atomic="true" className="border-t border-line pt-3">
      {state === undefined ? (
        <NotChecked rec={rec} />
      ) : state.status === "checking" ? (
        <p className="inline-flex items-center gap-1.5 text-meta font-medium text-status-idle">
          <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> Checking rights…
        </p>
      ) : state.status === "unavailable" ? (
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusPill status="idle" label="Check unavailable" />
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1 rounded text-meta text-ink underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none"
            >
              <RotateCwIcon className="size-3" aria-hidden /> Retry check
            </button>
          </div>
          <p className="text-meta text-ink-muted">{state.message} Rights are still checked in full when you select it.</p>
        </div>
      ) : (
        <Verdict result={state.result} featured={featured} />
      )}
    </div>
  );
}

function NotChecked({ rec }: { rec: RecommendationView }) {
  const recorded = rightsStatus(rec.rights.state, rec.rights.clearance);
  if (recorded !== "idle") return <StatusPill status={recorded} label={`Last check · ${STATUS[recorded].label}`} />;
  return <p className="text-meta text-ink-muted">Rights are checked in full when you select it.</p>;
}

const VERDICT: Record<OpportunityPreflight["verdict"], { status: (p: OpportunityPreflight) => Status; label: (p: OpportunityPreflight) => string }> = {
  ALLOWED: {
    status: (p) => (p.illustrative || p.clearance !== "VERIFIED" ? "provisional" : "clear"),
    label: (p) => (p.illustrative ? "Allowed under these illustrative rules" : "Allowed under these rules"),
  },
  BLOCKED: { status: () => "blocked", label: () => "Restrictions detected" },
  NEEDS_REVIEW: { status: () => "review", label: () => "Needs review" },
};

function Verdict({ result: p, featured }: { result: OpportunityPreflight; featured: boolean }) {
  const v = VERDICT[p.verdict];
  const f = p.verdict === "ALLOWED" ? undefined : topFinding(p);
  const hint = resolutionHint(p);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <StatusPill status={v.status(p)} label={v.label(p)} />
        <span className="text-meta text-ink-muted">
          {p.allowedUses > 0 && p.allowedUses < p.totalUses ? `${p.allowedUses} of ${p.totalUses} allowed · ` : ""}
          Checked {p.edited ? "the edit plan " : ""}for {p.plannedUses}
        </span>
      </div>
      {f && (
        <div className={cn("space-y-1 border-l pl-3", p.verdict === "BLOCKED" ? "border-status-blocked/50" : "border-status-review/50")}>
          <p className={cn("text-ink-soft", featured ? "text-small" : "text-meta")}>
            <span className="text-ink-muted">{f.topic}: </span>
            {f.found}
          </p>
          <p className="tabular text-meta text-ink-muted">
            {[f.source, f.at && spanLabel(f.at)].filter(Boolean).join(" · ")}
            {f.ruleId && (
              <>
                {" · rule "}
                <span className="font-mono break-all">{f.ruleId}</span>
              </>
            )}
          </p>
        </div>
      )}
      {f && featured && <p className="text-meta text-ink-muted">{calmDemoLabel(f.rule)}</p>}
      {hint && <p className={cn("text-ink-soft", featured ? "text-small" : "text-meta")}>{hint}</p>}
    </div>
  );
}

/** Why the search ranked this moment: what it matched and how it was scored. Collapsed by default. */
function SearchDetail({ rec }: { rec: RecommendationView }) {
  return (
    <details className="group/d min-w-0 text-small text-ink-muted">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 rounded transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 transition-transform group-open/d:rotate-90" aria-hidden /> Evidence
      </summary>
      <div className="mt-3 space-y-2 border-l border-line pl-3">
        <p className="text-ink-soft">{rec.why.media}</p>
        <p>{rec.why.opportunity}</p>
        <ul className="space-y-0.5 text-meta">
          {rec.matches.map((m) => (
            <li key={m.intent}>
              Matched “{m.label}” · {spanLabel(m)} · search rank {m.rank}
            </li>
          ))}
          <li className="tabular">Score {rec.score.toFixed(2)}</li>
        </ul>
      </div>
    </details>
  );
}
