"use client";

import { ArrowRightIcon, ChevronRightIcon, Loader2Icon, PencilLineIcon, RefreshCwIcon, RotateCwIcon } from "lucide-react";
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
  /** Card whose action is running (spinner on its CTA). */
  loadingKey: string | null;
  /** ALLOWED / NEEDS_REVIEW / unavailable / not yet checked → campaign. */
  onBuild: (rec: RecommendationView) => void;
  /** BLOCKED → existing Recovery Engine, context preserved. */
  onExplore: (rec: RecommendationView) => void;
  onSearchAgain: () => void;
  onEditGoal: () => void;
};

/**
 * Step 2 · Opportunity Studio: the strongest real moments for the objective as commercial opportunities — one
 * featured, two supporting. Each card leads with the media, then the angle and proposed post (from the objective,
 * plan and match evidence only), why PULSE recommends it, and REROUTE's selection-time preflight with the single
 * best next action. A restricted opportunity stays on the page with "Explore resolution". Retrieval ranks and scores
 * live in each card's collapsed detail.
 */
export function OpportunityStudio({ goal, preflight, busy, loadingKey, onBuild, onExplore, onSearchAgain, onEditGoal }: Props) {
  const recs = goal.recommendations;
  const [lead, ...rest] = recs;
  const states = recs.map((r) => preflight.get(r));
  const checking = states.some((s) => s !== undefined);
  const illustrative = goal.policy ? !goal.policy.verified : states.some((s) => s?.status === "done" && s.result.illustrative);

  const card = (rec: RecommendationView, featured: boolean) => {
    const state = preflight.get(rec);
    const blocked = state?.status === "done" && state.result.verdict === "BLOCKED";
    const inCampaign = goal.campaign?.key === rec.key && (goal.campaign.origin !== "PROPOSAL" || goal.rights.state !== "NOT_CHECKED");
    return (
      <Opportunity
        goal={goal}
        rec={rec}
        featured={featured}
        state={state}
        inCampaign={inCampaign}
        busy={busy}
        loading={loadingKey === rec.key}
        onAct={() => (blocked ? onExplore(rec) : onBuild(rec))}
        onRetry={() => preflight.retry(rec)}
      />
    );
  };

  if (!lead) {
    const photosOnly = goal.photos.length > 0;
    return (
      <section aria-labelledby="discover-title" className="space-y-6">
        <div>
          <Eyebrow>Opportunity Studio</Eyebrow>
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
        <PhotoSuggestions photos={goal.photos} note={goal.photosNote} standalone={photosOnly} />
      </section>
    );
  }

  return (
    <section aria-labelledby="discover-title">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <Eyebrow>
            Opportunity Studio · {recs.length} of {goal.run.library.videos} club videos
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
            Real club footage, located to the second{checking ? ", each checked against the rules as it appears" : ""}.
          </p>
          {checking && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
              <span>Rights: early check — not final. The campaign is checked again before review.</span>
              {illustrative && <PolicyContext verified={false} sourceType={goal.policy?.sourceType} />}
            </p>
          )}
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 gap-x-10 gap-y-14 lg:grid-cols-12">
        <Reveal className="lg:col-span-7">{card(lead, true)}</Reveal>
        {rest.length > 0 && (
          <div className="flex flex-col gap-12 lg:col-span-5 lg:border-l lg:border-line lg:pl-10">
            {rest.map((rec, i) => (
              <Reveal key={rec.key} delay={0.08 * (i + 1)}>
                {card(rec, false)}
              </Reveal>
            ))}
          </div>
        )}
      </div>

      <PhotoSuggestions photos={goal.photos} note={goal.photosNote} />
    </section>
  );
}

function Opportunity({
  goal,
  rec,
  featured,
  state,
  inCampaign,
  busy,
  loading,
  onAct,
  onRetry,
}: {
  goal: GoalView;
  rec: RecommendationView;
  featured: boolean;
  state: PreflightState | undefined;
  inCampaign: boolean;
  busy: boolean;
  loading: boolean;
  onAct: () => void;
  onRetry: () => void;
}) {
  const c = rec.candidate;
  const title = displayTitle(c.title);
  const headline = opportunityHeadline(goal, rec);
  const concept = postConcept(goal, rec);
  const headingId = `opportunity-${rec.key.replace(/[^a-z0-9]+/gi, "-")}`;
  const blocked = state?.status === "done" && state.result.verdict === "BLOCKED";
  const action = blocked ? "Explore resolution" : inCampaign ? "Continue campaign" : "Build campaign";
  return (
    <article aria-labelledby={headingId} className={cn("flex flex-col", featured ? "gap-5" : "gap-4")}>
      <MomentPreview key={rec.key} source={recommendationSource(rec)} size={featured ? "lead" : "compact"} label={featured ? "Featured opportunity" : undefined} />

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Eyebrow>{angleKicker(goal)}</Eyebrow>
          {inCampaign && <span className="rounded-full border border-line-strong px-2 py-0.5 text-meta text-ink-soft">In your campaign</span>}
        </div>
        <h2 id={headingId} className={cn("font-display font-medium text-balance text-ink", featured ? "text-headline" : "text-[1.0625rem] leading-snug")}>
          {headline}
        </h2>
        <p className="tabular text-small text-ink-muted">
          <span className="text-ink-soft" title={c.title}>
            {title}
          </span>
          <span className="px-1.5">·</span>
          {segmentLabel(c.startSeconds ?? 0, c.endSeconds, c.durationSec)}
          {scorePlayContext(goal, rec) && (
            <>
              <span className="px-1.5">·</span>
              {scorePlayContext(goal, rec)}
            </>
          )}
        </p>
      </div>

      <div className={cn("space-y-1.5", featured ? "text-body" : "text-small")}>
        <p className="text-ink-soft">
          <span className="text-ink">Proposed post. </span>
          {concept.cut} {featured && concept.action}
        </p>
        <p className="text-small text-ink-muted">
          <span className="text-ink-soft">Why PULSE recommends it: </span>
          {recommendationReason(goal, rec)}
        </p>
        {featured && (
          <p className="tabular text-meta text-ink-muted">
            {evidenceSource(rec)} · {matchEvidence(rec)}
          </p>
        )}
      </div>

      <Compliance state={state} rec={rec} featured={featured} onRetry={onRetry} />

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Button
          size="lg"
          variant={featured || inCampaign ? "default" : "outline"}
          disabled={busy}
          onClick={onAct}
          aria-label={`${action}: ${title}`}
          className={cn("h-10 rounded-lg px-4 font-semibold", !featured && !inCampaign && "bg-transparent")}
        >
          {loading && <Loader2Icon className="animate-spin" aria-hidden />}
          {action}
          {!loading && <ArrowRightIcon aria-hidden />}
        </Button>
        <SearchDetail rec={rec} />
      </div>
    </article>
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
          <p className="text-meta text-ink-muted">{state.message} Rights are still checked when you build the campaign.</p>
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
  return <p className="text-meta text-ink-muted">Rights are checked when you build the campaign.</p>;
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
