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
import { CLUBS } from "../clubs";
import type { Club, GoalAction, GoalView, RecommendationView } from "../types";
import { CampaignBrief, MediaStage } from "./CampaignStudio";
import { ObjectiveBar, StepNav, parseStep, type View } from "./Chrome";
import { ClubSwitcher } from "./ClubSwitcher";
import { Diagnostics, deskHref } from "./Diagnostics";
import { GoalComposer } from "./GoalComposer";
import { OpportunityPanel, PANEL_ID } from "./OpportunityPanel";
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

/**
 * Where each action's result is shown. Selecting, checking, correcting and submitting all stay on Opportunities &
 * Rights; Review & Audit is opened by the user ("Continue to Review & Audit").
 */
const VIEW_AFTER: Record<GoalAction["action"], View> = {
  run: "opportunities",
  select: "opportunities",
  draft: "opportunities",
  checkRights: "opportunities",
  findRecovery: "opportunities",
  applyRecovery: "opportunities",
  setPolicy: "opportunities",
  submitForReview: "opportunities",
};

/** Optimistic-concurrency rejection: the run changed elsewhere (another tab/reviewer). Retrying would fail again. */
function isConflict(error: unknown): boolean {
  const d = describeError(error);
  return d.code === "CONFLICT" || (d.code === "BAD_REQUEST" && d.detail.startsWith("This goal was updated elsewhere"));
}

function reachedViews(g: GoalView | null): Record<View, boolean> {
  return { goal: true, opportunities: !!g, review: !!g?.receiptId && g.reviewStatus !== "NOT_SUBMITTED" };
}

/** The step a restored run opens on: wherever the user's work last was. */
function defaultView(g: GoalView): View {
  return reachedViews(g).review ? "review" : "opportunities";
}

/** The campaign shown in the Step 2 detail panel: selected (or adopted) and not just the run's untouched proposal. */
function openCampaignKey(g: GoalView): string | null {
  const c = g.campaign;
  return c && (c.origin !== "PROPOSAL" || g.rights.state !== "NOT_CHECKED") ? c.key : null;
}

function urlState(): { run: string | null; step: View | null } {
  const q = new URLSearchParams(window.location.search);
  return { run: q.get("run"), step: parseStep(q.get("step")) };
}

function writeUrl(run: string | null, step: View, mode: "push" | "replace") {
  const href = run ? `/?${new URLSearchParams({ run, step })}` : "/";
  if (`${window.location.pathname}${window.location.search}` === href) return;
  if (mode === "push") window.history.pushState(null, "", href);
  else window.history.replaceState(null, "", href);
}

/** Brings the Step 2 detail panel (or a part of it) into view when it is off screen, e.g. below the cards on phones. */
function reveal(id: string, always = false) {
  window.setTimeout(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const top = el.getBoundingClientRect().top;
    if (always || top < 56 || top > window.innerHeight * 0.6) el.scrollIntoView({ block: "start", behavior: "smooth" });
  }, 150);
}

/**
 * PULSE in three steps: Goal → Opportunities & Rights → Review & Audit. One business goal becomes three real moments;
 * selecting one opens its campaign draft and a rights decision for every channel × market (with "Find a way to use
 * it" when restricted) beside the cards, then a human review and an audit receipt. The run id and step live in the
 * URL (`?run=…&step=…`, legacy `discover|campaign` = opportunities): a reload restores the exact state.
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
        const next = step && reachedViews(g)[step] ? step : defaultView(g);
        setView(next);
        // Legacy (`discover`/`campaign`) or unreachable steps are rewritten to the step actually shown.
        writeUrl(g.run.id, next, "replace");
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
   * Opens an opportunity card in the Step 2 detail panel without leaving the step: select its moment (new campaign
   * version) unless it already is the campaign, then record the real rights check when the run has no current one
   * (same engine, persisted and audited — no separate "Check rights" screen). `explore` (restricted card) continues
   * into the existing Recovery Engine ("Find a way to use it") and scrolls to the resolution. Each step runs on the
   * version the previous one returned; nothing is reused from the preflight.
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
      if (g.campaign?.key !== rec.key) await step({ action: "select", id: g.run.id, expectedVersion: g.version, key: rec.key }, `select:${rec.key}`);
      reveal(PANEL_ID);
      const checked = g.rights.current && g.rights.state !== "NOT_CHECKED";
      if (!checked) await step({ action: "checkRights", id: g.run.id, expectedVersion: g.version }, "rights");
      const restricted = g.rights.current && (g.rights.state === "BLOCKED" || g.rights.state === "NEEDS_REVIEW");
      const planned = g.recovery?.forEvaluationId === g.rights.evaluationId;
      if (explore && restricted && !planned) await step({ action: "findRecovery", id: g.run.id, expectedVersion: g.version }, "recovery");
      if (explore && restricted) reveal("resolution", true);
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

  /** The header club switch: a loaded campaign belongs to its club, so switching clears it and starts a new goal. */
  function switchClub(next: Club) {
    if (inflight.current || next === club) return;
    const hadRun = !!goal;
    setClub(next);
    if (hadRun) {
      startOver();
      toast(`Switched to ${CLUBS[next].label} — campaign cleared`);
    } else toast(`Switched to ${CLUBS[next].label}`);
  }

  const id = goal?.run.id;
  /** Run version the user is looking at; every action on the run sends it back (stale → CONFLICT). */
  const v = goal?.version ?? 0;
  const reached = reachedViews(goal);
  const shown: View = goal && !reached[view] ? defaultView(goal) : view;
  // Selection-time rights checks of the opportunity cards, only while the cards are on screen (cached per input basis).
  const preflight = usePreflight(goal, { enabled: shown === "opportunities" && busy !== "run" && busy !== "load" });
  const locked = busy !== null;
  const progress = busy ? PROGRESS[busy.startsWith("apply:") ? "apply" : busy] : undefined;
  const lensBusy: LensBusy =
    busy === "rights" || busy === "recovery" || busy === "policy" || busy === "submit" || busy?.startsWith("apply:") ? (busy as LensBusy) : null;
  const runGoal = () => void act({ action: "run", goal: text, club }, "run", (g) => !g.recommendations.length && toast.warning("No moment found for this goal"));
  const openKey = goal ? openCampaignKey(goal) : null;
  const openingKey = busy?.startsWith("select:") ? busy.slice(7) : null;

  return (
    <div className="flex min-h-dvh flex-col">
      <PulseHeader
        nav={goal ? <StepNav view={shown} reached={reached} onView={(next) => go(next, id ?? null)} /> : undefined}
        actions={
          <>
            <Link
              href={goal ? `/policies?${new URLSearchParams({ run: goal.run.id, ...(goal.policy ? { package: goal.policy.packageId } : {}) })}` : "/policies"}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-small text-ink-soft transition-colors hover:bg-surface hover:text-ink"
            >
              <ScaleIcon className="size-4" aria-hidden /> Policies
            </Link>
            <ReviewerControl session={session} onSignIn={() => setSignInOpen(true)} onSignedOut={setSession} />
            <ClubSwitcher club={club} disabled={locked} onChange={switchClub} />
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
              {shown === "opportunities" && (
                <OpportunityStudio
                  goal={goal}
                  preflight={preflight}
                  busy={locked}
                  loadingKey={openingKey}
                  openKey={openKey}
                  onSelect={(rec) => void openOpportunity(rec, false)}
                  onExplore={(rec) => void openOpportunity(rec, true)}
                  onShow={() => reveal(PANEL_ID, true)}
                  onSearchAgain={() => void act({ action: "run", goal: goal.run.objective.raw, club: goal.run.club }, "run")}
                  onEditGoal={() => go("goal", id)}
                  detail={
                    <OpportunityPanel
                      goal={goal}
                      open={openKey !== null}
                      opening={openingKey ? goal.recommendations.find((r) => r.key === openingKey) : undefined}
                      lead={goal.recommendations[0]}
                      busy={locked}
                      onSelectLead={() => goal.recommendations[0] && void openOpportunity(goal.recommendations[0], false)}
                      onContinue={() => go("review", id)}
                      media={goal.campaign && <MediaStage goal={goal} campaign={goal.campaign} onChangeMoment={() => reveal("opportunity-rail", true)} />}
                      lens={
                        <RightsLens
                          goal={goal}
                          busy={lensBusy}
                          disabled={locked}
                          progress={lensBusy ? progress : undefined}
                          deskHref={deskHref(goal)}
                          onCheck={() => void act({ action: "checkRights", id, expectedVersion: v }, "rights")}
                          onFindRecovery={() =>
                            void act({ action: "findRecovery", id, expectedVersion: v }, "recovery", (g) => g.recovery && reveal("resolution", true))
                          }
                          onApplyRecovery={(optionId) =>
                            void act({ action: "applyRecovery", id, expectedVersion: v, optionId }, `apply:${optionId}`, (g) =>
                              !g.rights.current
                                ? toast("Revised plan saved — check rights again")
                                : g.rights.state === "ALLOWED"
                                  ? toast.success("Revised plan saved and re-checked — same goal")
                                  : toast(`Revised plan saved — re-check: ${g.rights.headline}`),
                            )
                          }
                          onSetPolicy={(packageId) => {
                            if (packageId !== goal.policy?.packageId)
                              void act({ action: "setPolicy", id, expectedVersion: v, packageId }, "policy", () => toast("Rules changed — check rights again"));
                          }}
                          onSubmit={() =>
                            void act({ action: "submitForReview", id, expectedVersion: v }, "submit", () => {
                              toast.success("Submitted — audit receipt created");
                              reveal(PANEL_ID, true);
                            })
                          }
                          onOpenReview={() => go("review", id)}
                          onChooseAsset={() => reveal("opportunity-rail", true)}
                          onEditGoal={() => go("goal", id)}
                        />
                      }
                      brief={
                        goal.campaign && (
                          <CampaignBrief
                            goal={goal}
                            campaign={goal.campaign}
                            busy={locked}
                            saving={busy === "draft"}
                            onSetDestination={(url) =>
                              void act({ action: "draft", id, expectedVersion: v, commerceUrl: url }, "draft", () => toast.success("Destination link saved as a new version"))
                            }
                          />
                        )
                      }
                    />
                  }
                />
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
