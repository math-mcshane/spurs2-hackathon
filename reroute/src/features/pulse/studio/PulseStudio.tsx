"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeftIcon, Loader2Icon, PlusIcon, RefreshCwIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Swap } from "@/components/pulse/motion";
import { CONTAINER, PulseFooter, PulseHeader } from "@/components/pulse/shell";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/reroute/shared";
import { describeError } from "@/lib/api-client";
import { ReviewerControl, ReviewerSignInDialog, useReviewerSession } from "@/components/reroute/reviewer";
import { cn } from "@/lib/utils";
import { pulseApi } from "../client";
import type { Club, GoalAction, GoalView } from "../types";
import { CampaignBrief, MediaStage } from "./CampaignStudio";
import { ObjectiveBar, StepNav, VIEWS, type View } from "./Chrome";
import { Diagnostics, deskHref } from "./Diagnostics";
import { GoalComposer } from "./GoalComposer";
import { MomentGallery } from "./MomentGallery";
import { Notice, type Stage } from "./parts";
import { ReviewView } from "./Review";
import { RightsLens, type LensBusy } from "./RightsLens";

type Busy = null | "load" | "run" | "draft" | "rights" | "alternatives" | "remedy" | "submit" | `select:${string}` | `alt:${string}`;

/** What a long action is doing, in order (shown with elapsed seconds; cold caches take 20–70 s). */
const PROGRESS: Partial<Record<string, { stages: Stage[]; note?: string }>> = {
  run: {
    stages: [
      { after: 0, text: "Reading the goal" },
      { after: 1, text: "Searching the club's ScorePlay library" },
      { after: 3, text: "Finding matching moments with TwelveLabs" },
      { after: 8, text: "Ranking moments and drafting the campaign" },
    ],
  },
  rights: {
    stages: [
      { after: 0, text: "Reading the clip's ScorePlay record" },
      { after: 2, text: "Analysing the clip with TwelveLabs" },
      { after: 20, text: "Applying the rights policy to every channel and market" },
    ],
    note: "a first analysis can take up to ~70 s; recorded results return in seconds",
  },
  alternatives: {
    stages: [
      { after: 0, text: "Working out what blocks the campaign" },
      { after: 2, text: "Searching comparable footage" },
      { after: 8, text: "Checking each candidate independently" },
    ],
    note: "each replacement gets its own rights check; this can take up to ~70 s",
  },
  alt: {
    stages: [
      { after: 0, text: "Saving a new campaign version" },
      { after: 1, text: "Checking rights for the replacement" },
    ],
  },
  remedy: { stages: [{ after: 0, text: "Limiting the campaign to its licensed uses" }, { after: 1, text: "Saving a new campaign version" }] },
  submit: { stages: [{ after: 0, text: "Creating the audit receipt" }, { after: 1, text: "Recording the audit event" }] },
};

/** Where each action's result is shown. */
const VIEW_AFTER: Record<GoalAction["action"], View> = {
  run: "discover",
  select: "campaign",
  draft: "campaign",
  checkRights: "campaign",
  findAlternatives: "campaign",
  useAlternative: "campaign",
  applyRemedy: "campaign",
  submitForReview: "review",
};

/** Optimistic-concurrency rejection: the run changed elsewhere (another tab/reviewer). Retrying would fail again. */
function isConflict(error: unknown): boolean {
  const d = describeError(error);
  return d.code === "CONFLICT" || (d.code === "BAD_REQUEST" && d.detail.startsWith("This goal was updated elsewhere"));
}

function reachedViews(g: GoalView | null): Record<View, boolean> {
  return { goal: true, discover: !!g, campaign: !!g?.campaign, review: !!g?.receiptId && g.reviewStatus !== "NOT_SUBMITTED" };
}

/** The step a restored run opens on: wherever the user's work last was. */
function defaultView(g: GoalView): View {
  if (reachedViews(g).review) return "review";
  if (g.campaign && (g.rights.state !== "NOT_CHECKED" || g.campaign.origin !== "PROPOSAL")) return "campaign";
  return "discover";
}

function urlState(): { run: string | null; step: View | null } {
  const q = new URLSearchParams(window.location.search);
  const step = q.get("step");
  return { run: q.get("run"), step: VIEWS.some((v) => v.key === step) ? (step as View) : null };
}

function writeUrl(run: string | null, step: View, mode: "push" | "replace") {
  const href = run ? `/?${new URLSearchParams({ run, step })}` : "/";
  if (`${window.location.pathname}${window.location.search}` === href) return;
  if (mode === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
}

/**
 * PULSE: Goal → Discover → Create & clear → Review. One business goal becomes three real moments, a campaign
 * draft, a rights decision for every channel × market (with "Find another way" when restricted), a human review
 * and an audit receipt. The run id and step live in the URL (`?run=…&step=…`): a reload restores the exact state.
 */
export function PulseStudio() {
  const [goal, setGoal] = useState<GoalView | null>(null);
  const [view, setView] = useState<View>("goal");
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<{ error: unknown; retry: () => void } | null>(null);
  const [missingRun, setMissingRun] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [text, setText] = useState("");
  const [club, setClub] = useState<Club>("tottenham");
  const [signInOpen, setSignInOpen] = useState(false);
  const { session, setSession, error: sessionError, refresh: refreshSession } = useReviewerSession();
  /** Synchronous lock: a second click before the disabled state renders must not send a second request. */
  const inflight = useRef(false);

  const go = useCallback((next: View, run: string | null, mode: "push" | "replace" = "replace") => {
    setView(next);
    writeUrl(run, next, mode);
    window.scrollTo({ top: 0 });
  }, []);

  const load = useCallback(async (id: string, step: View | null) => {
    setBusy("load");
    setFailure(null);
    try {
      const g = await pulseApi.goal(id);
      setGoal(g);
      setMissingRun(g ? null : id);
      if (g) {
        setText(g.run.objective.raw);
        setClub(g.run.club);
        setView(step && reachedViews(g)[step] ? step : defaultView(g));
      }
    } catch (error) {
      setFailure({ error, retry: () => void load(id, step) });
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const { run, step } = urlState();
    if (run) void load(run, step);
    const onPop = () => {
      const s = urlState();
      if (s.run) void load(s.run, s.step);
      else {
        setGoal(null);
        setView("goal");
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [load]);

  async function act(body: GoalAction, kind: Exclude<Busy, null>, done?: (g: GoalView) => void) {
    if (inflight.current) return;
    inflight.current = true;
    setBusy(kind);
    setFailure(null);
    try {
      const g = await pulseApi.goalAction(body);
      const newRun = urlState().run !== g.run.id;
      setGoal(g);
      setMissingRun(null);
      const next = VIEW_AFTER[body.action];
      if (next !== view || newRun) go(next, g.run.id, newRun ? "push" : "replace");
      done?.(g);
    } catch (error) {
      if (isConflict(error)) {
        setConflict(true);
        return;
      }
      setFailure({ error, retry: () => void act(body, kind, done) });
      // A refused action may still have recorded something (e.g. a fresh verdict): show the server's state.
      if (goal && body.action !== "run") await pulseApi.goal(goal.run.id).then((g) => g && setGoal(g), () => undefined);
    } finally {
      inflight.current = false;
      setBusy(null);
    }
  }

  const refresh = () => goal && void pulseApi.goal(goal.run.id).then((g) => g && setGoal(g), (error) => setFailure({ error, retry: refresh }));

  function startOver() {
    setGoal(null);
    setFailure(null);
    setMissingRun(null);
    setConflict(false);
    setText("");
    go("goal", null, "push");
  }

  const id = goal?.run.id;
  /** Run version the user is looking at; every action on the run sends it back (stale → CONFLICT). */
  const v = goal?.version ?? 0;
  const reached = reachedViews(goal);
  const shown: View = goal && !reached[view] ? defaultView(goal) : view;
  const locked = busy !== null;
  const progress = busy ? PROGRESS[busy.startsWith("alt:") ? "alt" : busy] : undefined;
  const lensBusy: LensBusy = busy === "rights" || busy === "alternatives" || busy === "remedy" || busy === "submit" || busy?.startsWith("alt:") ? (busy as LensBusy) : null;
  const runGoal = () => void act({ action: "run", goal: text, club }, "run", (g) => !g.recommendations.length && toast.warning("No moment found for this goal"));

  return (
    <div className="flex min-h-dvh flex-col">
      <PulseHeader
        nav={goal ? <StepNav view={shown} reached={reached} onView={(next) => go(next, id ?? null)} /> : undefined}
        actions={
          <>
            <ReviewerControl session={session} onSignIn={() => setSignInOpen(true)} onSignedOut={setSession} />
            {goal && (
              <Button size="sm" variant="outline" className="bg-transparent" onClick={startOver}>
                <PlusIcon /> New goal
              </Button>
            )}
          </>
        }
      />

      <main className="flex flex-1 flex-col">
        {(conflict || failure || missingRun) && (
          <div className={cn(CONTAINER, "space-y-3 pt-6")}>
            {conflict && id && (
              <Notice
                tone="warning"
                actions={
                  <Button
                    size="sm"
                    disabled={locked}
                    onClick={() => {
                      setConflict(false);
                      void load(id, shown);
                    }}
                  >
                    <RefreshCwIcon /> Reload
                  </Button>
                }
              >
                This campaign was updated elsewhere (another tab or a reviewer). Reload to see the latest version before continuing.
              </Notice>
            )}
            {failure && (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
                <ErrorState error={failure.error} className="flex-1" />
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={locked} onClick={failure.retry}>
                    <RefreshCwIcon /> Retry
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Dismiss error" onClick={() => setFailure(null)}>
                    <XIcon />
                  </Button>
                </div>
              </div>
            )}
            {missingRun && (
              <Notice
                tone="warning"
                actions={
                  <Button size="sm" variant="outline" onClick={startOver}>
                    <PlusIcon /> New goal
                  </Button>
                }
              >
                This campaign wasn&apos;t found. It may have been created on another server or removed.
              </Notice>
            )}
          </div>
        )}

        {busy === "load" && !goal ? (
          <p role="status" className="flex flex-1 items-center justify-center gap-2 text-small text-ink-muted">
            <Loader2Icon className="size-4 animate-spin" aria-hidden /> Restoring your campaign…
          </p>
        ) : shown === "goal" || !goal || !id ? (
          <GoalComposer
            text={text}
            onText={setText}
            club={club}
            onClub={setClub}
            busy={busy === "run"}
            progress={progress}
            onSubmit={runGoal}
            aside={
              goal && (
                <button type="button" onClick={() => go(defaultView(goal), id ?? null)} className="inline-flex items-center gap-1.5 text-small text-ink-muted hover:text-ink">
                  <ArrowLeftIcon className="size-3.5" aria-hidden /> Back to “{goal.run.objective.summary}”
                </button>
              )
            }
          />
        ) : (
          <>
            <ObjectiveBar goal={goal} onEdit={() => go("goal", id)} />
            <Swap id={shown} className={cn(CONTAINER, "flex-1 py-8 lg:py-10")}>
              {shown === "discover" && (
                <MomentGallery
                  goal={goal}
                  busy={locked}
                  loadingKey={busy?.startsWith("select:") ? busy.slice(7) : null}
                  onChoose={(rec) =>
                    goal.campaign?.key === rec.key
                      ? go("campaign", id)
                      : void act({ action: "select", id, expectedVersion: v, key: rec.key }, `select:${rec.key}`)
                  }
                  onSearchAgain={() => void act({ action: "run", goal: goal.run.objective.raw, club: goal.run.club }, "run")}
                  onEditGoal={() => go("goal", id)}
                />
              )}

              {shown === "campaign" && goal.campaign && (
                <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-12">
                  <div className="min-w-0 lg:col-span-7 lg:row-start-1">
                    <MediaStage goal={goal} campaign={goal.campaign} onChangeMoment={() => go("discover", id)} />
                  </div>
                  <aside className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-span-2 lg:row-start-1">
                    <div className="lg:sticky lg:top-20 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:overscroll-contain lg:rounded-xl [scrollbar-width:thin]">
                      <RightsLens
                        goal={goal}
                        busy={lensBusy}
                        disabled={locked}
                        progress={lensBusy ? progress : undefined}
                        deskHref={deskHref(goal)}
                        onCheck={() => void act({ action: "checkRights", id, expectedVersion: v }, "rights")}
                        onFindAnotherWay={() => void act({ action: "findAlternatives", id, expectedVersion: v }, "alternatives")}
                        onUseAlternative={(key) =>
                          void act({ action: "useAlternative", id, expectedVersion: v, key }, `alt:${key}`, () => toast.success("Replacement adopted and re-checked — same goal"))
                        }
                        onApplyRemedy={() =>
                          void act({ action: "applyRemedy", id, expectedVersion: v }, "remedy", () => toast("Campaign limited to its licensed markets — check rights again"))
                        }
                        onSubmit={() => void act({ action: "submitForReview", id, expectedVersion: v }, "submit", () => toast.success("Submitted — audit receipt created"))}
                        onOpenReview={() => go("review", id)}
                        onEditGoal={() => go("goal", id)}
                      />
                    </div>
                  </aside>
                  <div className="min-w-0 lg:col-span-7 lg:row-start-2">
                    <CampaignBrief
                      goal={goal}
                      campaign={goal.campaign}
                      busy={locked}
                      saving={busy === "draft"}
                      onSetDestination={(url) => void act({ action: "draft", id, expectedVersion: v, commerceUrl: url }, "draft", () => toast.success("Destination link saved as a new version"))}
                    />
                  </div>
                </div>
              )}

              {shown === "review" && goal.receiptId && (
                <ReviewView goal={goal} session={session} sessionError={sessionError} onRetrySession={refreshSession} onSignIn={() => setSignInOpen(true)} onChanged={refresh} />
              )}

              <div className="mt-16">
                <Diagnostics goal={goal} />
              </div>
            </Swap>
          </>
        )}
      </main>

      <PulseFooter>
        PULSE drafts and checks; it never publishes or buys media. Rights decisions come from its REROUTE rights engine — AI video analysis is evidence, never a licence.
        Footage stays in ScorePlay and TwelveLabs.
      </PulseFooter>

      <ReviewerSignInDialog
        open={signInOpen}
        onOpenChange={setSignInOpen}
        onSignedIn={(s) => {
          setSession(s);
          toast.success(`Signed in as ${s.reviewer?.name ?? "reviewer"}`);
        }}
      />
    </div>
  );
}
