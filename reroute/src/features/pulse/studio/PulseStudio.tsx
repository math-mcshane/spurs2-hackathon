"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, Loader2Icon, PlusIcon, RefreshCwIcon, ScaleIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Swap } from "@/components/pulse/motion";
import { CONTAINER, PulseFooter, PulseHeader } from "@/components/pulse/shell";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/reroute/shared";
import { describeError } from "@/lib/api-client";
import { ReviewerControl, ReviewerSignInDialog, useReviewerSession } from "@/components/reroute/reviewer";
import { cn } from "@/lib/utils";
import { pulseApi } from "../client";
import type { Club, GoalAction, GoalView, RecommendationView } from "../types";
import { CampaignBrief, MediaStage } from "./CampaignStudio";
import { ObjectiveBar, StepNav, VIEWS, type View } from "./Chrome";
import { Diagnostics, deskHref } from "./Diagnostics";
import { GoalComposer } from "./GoalComposer";
import { OpportunityStudio } from "./OpportunityStudio";
import { Notice, type Stage } from "./parts";
import { ReviewView } from "./Review";
import { RightsLens, type LensBusy } from "./RightsLens";
import { usePreflight } from "./use-preflight";

type Busy = null | "load" | "run" | "draft" | "rights" | "recovery" | "policy" | "submit" | `select:${string}` | `apply:${string}`;

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
  recovery: {
    stages: [
      { after: 0, text: "Locating the restricted seconds in the clip" },
      { after: 2, text: "Planning a cut around them" },
      { after: 4, text: "Searching the club's footage for a replacement" },
      { after: 8, text: "Re-checking every option against the rules" },
    ],
    note: "each option gets its own rights check; this can take up to ~70 s",
  },
  apply: {
    stages: [
      { after: 0, text: "Saving the revised plan as a new campaign version" },
      { after: 1, text: "Re-checking every use" },
    ],
  },
  policy: { stages: [{ after: 0, text: "Switching the rule package" }] },
  submit: { stages: [{ after: 0, text: "Creating the audit receipt" }, { after: 1, text: "Recording the audit event" }] },
};

/** Where each action's result is shown. */
const VIEW_AFTER: Record<GoalAction["action"], View> = {
  run: "discover",
  select: "campaign",
  draft: "campaign",
  checkRights: "campaign",
  findRecovery: "campaign",
  applyRecovery: "campaign",
  setPolicy: "campaign",
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
  return { run: q.get("run"), step: VIEWS.includes(step as View) ? (step as View) : null };
}

function writeUrl(run: string | null, step: View, mode: "push" | "replace") {
  const href = run ? `/?${new URLSearchParams({ run, step })}` : "/";
  if (`${window.location.pathname}${window.location.search}` === href) return;
  if (mode === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
}

/**
 * PULSE: Goal → Media → Campaign → Compliance → Resolution → Review. One business goal becomes three real moments, a campaign
 * draft, a rights decision for every channel × market (with "Find a way to use it" when restricted), a human review
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

  /**
   * Opens an opportunity card in the campaign step: select its moment (new campaign version) and, when its selection-time
   * preflight produced a verdict, record the real check right away (same engine, persisted and audited). `explore`
   * (restricted card) continues into the existing Recovery Engine ("Find a way to use it") and lands on Resolution.
   * Each step runs on the version the previous one returned; nothing is reused from the preflight but the decision to proceed.
   */
  async function openOpportunity(rec: RecommendationView, explore: boolean) {
    if (inflight.current || !goal) return;
    inflight.current = true;
    setFailure(null);
    let g = goal;
    const step = async (body: GoalAction, kind: Exclude<Busy, null>) => {
      setBusy(kind);
      g = await pulseApi.goalAction(body);
      setGoal(g);
    };
    try {
      const preflighted = preflight.get(rec)?.status === "done";
      if (g.campaign?.key !== rec.key) await step({ action: "select", id: g.run.id, expectedVersion: g.version, key: rec.key }, `select:${rec.key}`);
      go("campaign", g.run.id);
      const checked = g.rights.current && g.rights.state !== "NOT_CHECKED";
      if (!checked && (explore || preflighted)) await step({ action: "checkRights", id: g.run.id, expectedVersion: g.version }, "rights");
      const restricted = g.rights.current && (g.rights.state === "BLOCKED" || g.rights.state === "NEEDS_REVIEW");
      const planned = g.recovery?.forEvaluationId === g.rights.evaluationId;
      if (explore && restricted && !planned) await step({ action: "findRecovery", id: g.run.id, expectedVersion: g.version }, "recovery");
      if (explore && restricted) window.setTimeout(() => document.getElementById("resolution")?.scrollIntoView({ block: "start", behavior: "smooth" }), 150);
    } catch (error) {
      if (isConflict(error)) setConflict(true);
      else {
        setFailure({ error, retry: () => void openOpportunity(rec, explore) });
        await pulseApi.goal(g.run.id).then((x) => x && setGoal(x), () => undefined);
      }
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
  // Selection-time rights checks of the opportunity cards, only while the cards are on screen (cached per input basis).
  const preflight = usePreflight(goal, { enabled: shown === "discover" && busy !== "run" && busy !== "load" });
  const locked = busy !== null;
  const progress = busy ? PROGRESS[busy.startsWith("apply:") ? "apply" : busy] : undefined;
  const lensBusy: LensBusy =
    busy === "rights" || busy === "recovery" || busy === "policy" || busy === "submit" || busy?.startsWith("apply:") ? (busy as LensBusy) : null;
  const runGoal = () => void act({ action: "run", goal: text, club }, "run", (g) => !g.recommendations.length && toast.warning("No moment found for this goal"));
  /** Header journey: Campaign, Compliance and Resolution share the campaign screen; an anchor scrolls to its part. */
  const goPhase = (next: View, anchor?: string) => {
    const target = anchor && next === shown ? document.getElementById(anchor) : null;
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    else go(next, id ?? null);
  };

  return (
    <div className="flex min-h-dvh flex-col">
      <PulseHeader
        nav={goal ? <StepNav goal={goal} view={shown} reached={reached} onView={goPhase} /> : undefined}
        actions={
          <>
            <Link
              href={goal ? `/policies?${new URLSearchParams({ run: goal.run.id, ...(goal.policy ? { package: goal.policy.packageId } : {}) })}` : "/policies"}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-small text-ink-soft transition-colors hover:bg-surface hover:text-ink"
            >
              <ScaleIcon className="size-4" aria-hidden /> Policies
            </Link>
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
                <OpportunityStudio
                  goal={goal}
                  preflight={preflight}
                  busy={locked}
                  loadingKey={busy?.startsWith("select:") ? busy.slice(7) : null}
                  onBuild={(rec) => void openOpportunity(rec, false)}
                  onExplore={(rec) => void openOpportunity(rec, true)}
                  onSearchAgain={() => void act({ action: "run", goal: goal.run.objective.raw, club: goal.run.club }, "run")}
                  onEditGoal={() => go("goal", id)}
                />
              )}

              {shown === "campaign" && goal.campaign && (
                <div className="grid grid-cols-1 gap-x-12 gap-y-10 lg:grid-cols-12 lg:grid-rows-[auto_1fr]">
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
                        onFindRecovery={() => void act({ action: "findRecovery", id, expectedVersion: v }, "recovery")}
                        onApplyRecovery={(optionId) =>
                          void act({ action: "applyRecovery", id, expectedVersion: v, optionId }, `apply:${optionId}`, (g) =>
                            g.rights.current ? toast.success("Revised plan saved and re-checked — same goal") : toast("Revised plan saved — check rights again"),
                          )
                        }
                        onSetPolicy={(packageId) => {
                          if (packageId !== goal.policy?.packageId)
                            void act({ action: "setPolicy", id, expectedVersion: v, packageId }, "policy", () => toast("Rules changed — check rights again"));
                        }}
                        onSubmit={() => void act({ action: "submitForReview", id, expectedVersion: v }, "submit", () => toast.success("Submitted — audit receipt created"))}
                        onOpenReview={() => go("review", id)}
                        onChooseAsset={() => go("discover", id)}
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
        PULSE proposes and checks campaigns — it never publishes or buys media. AI video analysis is evidence, not a licence.
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
