"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRightIcon, Loader2Icon, PlusIcon, RefreshCwIcon, SearchXIcon, SparklesIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ErrorState } from "@/components/reroute/shared";
import { describeError } from "@/lib/api-client";
import { ReviewerControl, ReviewerSignInDialog, useReviewerSession } from "@/components/reroute/reviewer";
import { cn } from "@/lib/utils";
import { CLUBS } from "../clubs";
import { pulseApi } from "../client";
import type { Club, GoalAction, GoalView } from "../types";
import { Diagnostics } from "./Diagnostics";
import { MomentCard } from "./MomentCard";
import { Proposal } from "./Proposal";
import { ReceiptView } from "./Receipt";
import { ReviewStage } from "./Review";
import { AnotherWay, VerdictPanel, type VerdictBusy } from "./Verdict";
import { CHANNEL_LABEL, ProvenanceBadge, STEPS, StagedProgress, StepHeading, Stepper, type Stage, type StepKey, type StepState } from "./parts";

/** The product promise, shown until a goal is run. */
const PROMISE = "Turn business objectives into actionable, rights-aware sports media campaigns.";

/** One-click demo goals per club: the two flagship scenarios + a market the demo policy does not license. */
const EXAMPLES: Record<Club, string[]> = {
  tottenham: [
    "Promote Tottenham merchandise to UK supporters",
    "Maximize global engagement from the Manchester United game",
    "Sell more Spurs jerseys in Mexico",
  ],
  spurs: ["Sell Spurs jerseys in Mexico using the best moments from the Kings game"],
};

type Busy = null | "load" | "run" | "draft" | "rights" | "alternatives" | "remedy" | "submit" | `select:${string}` | `alt:${string}`;

/** What a long action is doing, in order (shown with elapsed seconds; cold caches take 20–70 s). */
const PROGRESS: Partial<Record<string, { stages: Stage[]; note?: string }>> = {
  run: {
    stages: [
      { after: 0, text: "Reading the goal" },
      { after: 1, text: "Searching the ScorePlay library" },
      { after: 3, text: "Asking TwelveLabs for matching moments" },
      { after: 8, text: "Ranking moments & drafting the proposal" },
    ],
  },
  rights: {
    stages: [
      { after: 0, text: "Reading ScorePlay metadata" },
      { after: 2, text: "Analysing the clip with TwelveLabs" },
      { after: 20, text: "Applying the rights policy to every channel × territory" },
    ],
    note: "a first analysis of a clip can take up to ~70 s; recorded results return in seconds",
  },
  alternatives: {
    stages: [
      { after: 0, text: "Classifying what blocks the campaign" },
      { after: 2, text: "Searching comparable footage" },
      { after: 8, text: "Re-checking each candidate independently" },
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

/** Optimistic-concurrency rejection: the run changed elsewhere (another tab/reviewer). Retrying would fail again. */
function isConflict(error: unknown): boolean {
  const d = describeError(error);
  return d.code === "CONFLICT" || (d.code === "BAD_REQUEST" && d.detail.startsWith("This goal was updated elsewhere"));
}

/** Section each action's result belongs to: brought into view once it has rendered. */
const SECTION_AFTER: Record<GoalAction["action"], StepKey> = {
  run: "moment",
  select: "proposal",
  draft: "proposal",
  checkRights: "rights",
  findAlternatives: "rights",
  useAlternative: "rights",
  applyRemedy: "rights",
  submitForReview: "review",
};

/** Index of the step the user is on (STEPS order); STEPS.length = everything done. */
function currentStep(goal: GoalView | null): number {
  if (!goal) return 0;
  if (!goal.campaign) return 1;
  if (goal.rights.state === "NOT_CHECKED") return 2;
  if (goal.reviewStatus === "NOT_SUBMITTED" || !goal.rights.current) return 3;
  if (goal.reviewStatus === "PENDING") return 4;
  return goal.writeback.status === "NOT_STARTED" ? 5 : STEPS.length;
}

function runIdFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get("run");
}

/**
 * The product: business goal → three real moments → campaign proposal → REROUTE rights verdict →
 * "Find another way" → human review → audit receipt with the ScorePlay writeback plan. The goal run
 * id lives in the URL (`?run=`), so a reload restores the exact state from the server.
 */
export function PulseStudio() {
  const [goal, setGoal] = useState<GoalView | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [failure, setFailure] = useState<{ error: unknown; retry: () => void } | null>(null);
  const [missingRun, setMissingRun] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  const [text, setText] = useState("");
  const [club, setClub] = useState<Club>("tottenham");
  const [signInOpen, setSignInOpen] = useState(false);
  const { session, setSession, error: sessionError, refresh: refreshSession } = useReviewerSession();
  const scrollTo = useRef<StepKey | null>(null);
  /** Synchronous lock: a second click before the disabled state renders must not send a second request. */
  const inflight = useRef(false);

  useEffect(() => {
    if (!scrollTo.current) return;
    document.getElementById(`s-${scrollTo.current}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    scrollTo.current = null;
  }, [goal]);

  const load = useCallback(async (id: string) => {
    setBusy("load");
    setFailure(null);
    try {
      const g = await pulseApi.goal(id);
      setGoal(g);
      setMissingRun(g ? null : id);
      if (g) {
        setText(g.run.objective.raw);
        setClub(g.run.club);
      }
    } catch (error) {
      setFailure({ error, retry: () => void load(id) });
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    const id = runIdFromUrl();
    if (id) void load(id);
    const onPop = () => {
      const next = runIdFromUrl();
      if (next) void load(next);
      else setGoal(null);
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
      scrollTo.current = SECTION_AFTER[body.action];
      setGoal(g);
      setMissingRun(null);
      if (runIdFromUrl() !== g.run.id) window.history.pushState(null, "", `/?${new URLSearchParams({ run: g.run.id })}`);
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
    window.history.pushState(null, "", "/");
    document.getElementById("goal-text")?.focus();
  }

  const id = goal?.run.id;
  /** Run version the user is looking at; every action on the run sends it back (stale → CONFLICT). */
  const v = goal?.version ?? 0;
  const at = currentStep(goal);
  const states = Object.fromEntries(STEPS.map((s, i) => [s.key, (i < at ? "done" : i === at ? "current" : "todo") as StepState])) as Record<StepKey, StepState>;
  const locked = busy !== null;
  const progress = busy ? PROGRESS[busy.startsWith("alt:") ? "alt" : busy] : undefined;
  const rightsBusy = busy === "rights" || busy === "alternatives" || busy === "remedy" || busy?.startsWith("alt:");

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.08),transparent_60%)]">
      <header className="sticky top-0 z-30 border-b border-white/8 bg-zinc-950/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-2.5">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="font-mono text-base font-black tracking-[0.25em] text-zinc-50">
              PU<span className="text-sky-400">●</span>LSE <span className="text-zinc-600">×</span> RE<span className="text-red-500">●</span>ROUTE
            </span>
            <span className="hidden truncate text-xs text-zinc-400 lg:inline">{PROMISE}</span>
          </div>
          <div className="flex items-center gap-3">
            <ReviewerControl session={session} onSignIn={() => setSignInOpen(true)} onSignedOut={setSession} />
            {goal && (
              <Button size="sm" variant="ghost" onClick={startOver}>
                <PlusIcon /> New goal
              </Button>
            )}
          </div>
        </div>
        <div className="mx-auto w-full max-w-7xl space-y-1 px-4 pb-2.5">
          <Stepper states={states} />
          {goal && (
            <p className="flex items-center gap-1.5 text-xs text-sky-200" aria-live="polite">
              <ArrowRightIcon className="size-3.5 shrink-0" aria-hidden /> <span className="text-zinc-400">Next:</span> {goal.nextStep}
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto flex w-full min-w-0 max-w-7xl flex-1 flex-col gap-10 px-4 py-6">
        {conflict && id && (
          <div role="alert" className="flex flex-col gap-2 rounded-xl border border-sky-500/40 bg-sky-500/10 p-4 text-sm text-sky-100 sm:flex-row sm:items-center sm:justify-between">
            <span>This campaign was updated elsewhere (another tab or reviewer). Reload to see the latest version before continuing.</span>
            <Button
              size="sm"
              disabled={locked}
              onClick={() => {
                setConflict(false);
                void load(id);
              }}
            >
              <RefreshCwIcon /> Reload
            </Button>
          </div>
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

        {/* 1 · Goal */}
        <section aria-labelledby="s-goal-title" className="space-y-3">
          {!goal && busy !== "load" && <PromiseHero />}
          <StepHeading id="s-goal" n={1} active={at === 0} title="What do you want to achieve?" sub="Describe the business objective — market, product, match. We find real club footage for it." />
          <form
            className="space-y-3 rounded-xl border border-white/10 bg-zinc-950/60 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: "run", goal: text, club }, "run", (g) => {
                if (g.recommendations.length) toast.success(`${g.recommendations.length} moments found · proposal drafted`);
                else toast.warning("No moment found for this goal");
              });
            }}
          >
            <Label htmlFor="goal-text" id="s-goal-title">
              Business objective
            </Label>
            <textarea
              id="goal-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={2}
              maxLength={280}
              placeholder={EXAMPLES.tottenham[0]}
              className="w-full resize-none rounded-lg border border-input bg-input/30 px-3 py-2 text-base text-zinc-50 outline-none placeholder:text-zinc-600 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Example objectives">
              <span className="text-[11px] text-zinc-500">Try one:</span>
              {EXAMPLES[club].map((ex) => (
                <button
                  key={ex}
                  type="button"
                  disabled={locked}
                  onClick={() => setText(ex)}
                  aria-pressed={text === ex}
                  className={cn(
                    "max-w-full rounded-full border px-3 py-1 text-left text-xs transition-colors disabled:opacity-50",
                    text === ex ? "border-sky-400 bg-sky-500/15 text-sky-100" : "border-white/15 text-zinc-300 hover:border-sky-500/50 hover:text-sky-200",
                  )}
                >
                  {ex}
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2 border-t border-white/5 pt-3 sm:flex-row sm:items-center">
              <div className="flex items-center gap-2">
                <Label htmlFor="goal-club" className="text-xs text-zinc-400">
                  Club
                </Label>
                <select
                  id="goal-club"
                  value={club}
                  disabled={locked}
                  onChange={(e) => setClub(e.target.value === "spurs" ? "spurs" : "tottenham")}
                  className="h-8 rounded-lg border border-input bg-input/30 px-2 text-xs"
                >
                  {Object.entries(CLUBS).map(([k, c]) => (
                    <option key={k} value={k}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
              <Button
                type="submit"
                size="lg"
                className="sm:ml-auto"
                disabled={locked || text.trim().length < 3}
                title={text.trim().length < 3 ? "Type a business objective or pick an example first" : undefined}
              >
                {busy === "run" ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />} Find the best moments
              </Button>
            </div>
            {busy === "run" && progress && <StagedProgress stages={progress.stages} note={progress.note} />}
          </form>
          {goal && <Understood goal={goal} />}
        </section>

        {busy === "load" && !goal && (
          <p role="status" className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2Icon className="size-4 animate-spin" aria-hidden /> Restoring your campaign…
          </p>
        )}
        {missingRun && (
          <div role="alert" className="flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100 sm:flex-row sm:items-center sm:justify-between">
            <span>This campaign wasn&apos;t found. It may have been created on another server or removed.</span>
            <Button size="sm" variant="outline" onClick={startOver}>
              <PlusIcon /> New goal
            </Button>
          </div>
        )}
        {busy === "run" && <MomentSkeletons />}

        {/* 2 · Moments */}
        {goal && busy !== "run" && (
          <section aria-labelledby="s-moment" className="space-y-3">
            <StepHeading
              id="s-moment"
              n={2}
              active={at === 1}
              title={goal.recommendations.length ? `${goal.recommendations.length} real moments for this goal` : "No moment found"}
              sub={
                goal.recommendations.length ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span>
                      {goal.recommendations.some((r) => r.preview)
                        ? "Real moments from the club's ScorePlay library, located by TwelveLabs with exact timestamps. Pick the one to build on."
                        : "Real moments from the club's ScorePlay library, located by TwelveLabs with exact timestamps. Video playback is off until the organizers confirm playback rights."}
                    </span>
                    {goal.dataOrigin && <ProvenanceBadge origin={goal.dataOrigin} />}
                  </span>
                ) : (
                  goal.run.search.message
                )
              }
            />
            {goal.recommendations.length === 0 ? (
              <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                <SearchXIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <div className="space-y-2">
                  <p>
                    We never fill the gap with invented clips.
                    {goal.run.search.status === "NOT_INDEXED"
                      ? " This club's footage is not indexed in TwelveLabs yet."
                      : goal.run.search.status === "UNAVAILABLE"
                        ? " The video search is unavailable right now."
                        : " Try a different product, market or match."}
                  </p>
                  <Button size="sm" variant="outline" disabled={locked} onClick={() => void act({ action: "run", goal: goal.run.objective.raw, club: goal.run.club }, "run")}>
                    <RefreshCwIcon /> Search again
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3">
                {goal.recommendations.map((rec, i) => (
                  <MomentCard
                    key={rec.key}
                    rec={rec}
                    position={i + 1}
                    selected={goal.campaign?.key === rec.key}
                    busy={locked}
                    loading={busy === `select:${rec.key}`}
                    primary={!goal.campaign}
                    onChoose={() => id && void act({ action: "select", id, expectedVersion: v, key: rec.key }, `select:${rec.key}`, () => toast.success("Proposal rebuilt for this moment"))}
                  />
                ))}
              </div>
            )}
          </section>
        )}

        {/* 3 · Proposal */}
        {goal?.campaign && id && (
          <section aria-labelledby="s-proposal" className="space-y-3">
            <StepHeading
              id="s-proposal"
              n={3}
              active={at === 2}
              title="Campaign proposal"
              sub={`Draft v${goal.campaign.version} for “${goal.campaign.objective.summary}” — nothing is published and no ads are bought.`}
            />
            <Proposal
              goal={goal}
              campaign={goal.campaign}
              busy={locked}
              onSetDestination={(url) => void act({ action: "draft", id, expectedVersion: v, commerceUrl: url }, "draft", () => toast.success("Destination link added — new version"))}
            />
          </section>
        )}

        {/* 4 · Rights */}
        {goal?.campaign && id && (
          <section aria-labelledby="s-rights" className="space-y-4">
            <StepHeading
              id="s-rights"
              n={4}
              active={at === 3}
              title="Rights"
              sub={
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span>Checked against the clip&apos;s ScorePlay data and the club&apos;s rights policy. What the video analysis sees is evidence, never a licence.</span>
                  {goal.dataOrigin && <ProvenanceBadge origin={goal.dataOrigin} />}
                </span>
              }
            />
            <VerdictPanel
              rights={goal.rights}
              busy={busy === "rights" || busy === "alternatives" ? busy : null}
              disabled={locked}
              searched={goal.alternatives?.forEvaluationId === goal.rights.evaluationId}
              onCheck={() => void act({ action: "checkRights", id, expectedVersion: v }, "rights")}
              onFindAnotherWay={() => void act({ action: "findAlternatives", id, expectedVersion: v }, "alternatives")}
            />
            {rightsBusy && progress && <StagedProgress stages={progress.stages} note={progress.note} />}
            <AnotherWay
              goal={goal}
              busy={busy === "remedy" || busy?.startsWith("alt:") ? (busy as VerdictBusy) : null}
              disabled={locked}
              onUse={(key) => void act({ action: "useAlternative", id, expectedVersion: v, key }, `alt:${key}`, () => toast.success("Alternative adopted — same goal, re-checked"))}
              onApplyRemedy={() =>
                void act({ action: "applyRemedy", id, expectedVersion: v }, "remedy", () => toast.info("Campaign limited to its licensed uses — check rights again"))
              }
            />
          </section>
        )}

        {/* 5 · Review */}
        {goal?.campaign && id && (
          <section aria-labelledby="s-review" className="space-y-3">
            <StepHeading id="s-review" n={5} active={at === 4} title="Review & publish" sub="A signed-in rights reviewer approves or rejects. Publishing unlocks only with verified clearance and approval." />
            <ReviewStage
              goal={goal}
              session={session}
              sessionError={sessionError}
              onRetrySession={refreshSession}
              submitting={busy === "submit"}
              disabled={locked}
              onSubmit={() => void act({ action: "submitForReview", id, expectedVersion: v }, "submit", () => toast.success("Submitted — audit receipt created"))}
              onSignIn={() => setSignInOpen(true)}
              onReviewed={refresh}
            />
            {busy === "submit" && progress && <StagedProgress stages={progress.stages} />}
          </section>
        )}

        {/* 6 · Receipt */}
        {goal?.campaign && (
          <section aria-labelledby="s-receipt" className="space-y-3">
            <StepHeading id="s-receipt" n={6} active={at === 5} title="Audit receipt" sub="What was decided, under which policy, for which media, by whom — and what would be written back to ScorePlay." />
            {goal.receiptId ? (
              <ReceiptView
                receiptId={goal.receiptId}
                version={`${goal.reviewStatus}:${goal.writeback.status}:${goal.writeback.at ?? ""}`}
                session={session}
                onSignIn={() => setSignInOpen(true)}
                onWriteback={refresh}
              />
            ) : (
              <p className="rounded-xl border border-dashed border-white/10 p-4 text-xs text-zinc-500">The receipt appears once the campaign is submitted for review.</p>
            )}
          </section>
        )}

        {goal && <Diagnostics goal={goal} />}
      </main>

      <footer className="px-4 pb-4 text-center text-[10px] text-zinc-600">
        PULSE recommends and drafts; it never publishes, buys ads or decides rights. Rights verdicts come only from REROUTE. Footage is streamed from ScorePlay /
        TwelveLabs for preview only — nothing is downloaded.
      </footer>

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

/** Empty state: the product promise and the journey in one line each, so nobody needs instructions. */
function PromiseHero() {
  return (
    <div className="space-y-2 pb-2">
      <h1 className="max-w-3xl text-2xl leading-tight font-semibold text-balance text-zinc-50 sm:text-3xl">{PROMISE}</h1>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-zinc-400 sm:text-sm">
        <li>
          <span className="font-medium text-sky-200">One goal</span>
        </li>
        <li aria-hidden>→</li>
        <li>
          <span className="font-medium text-sky-200">three real moments</span> from the ScorePlay library, found by TwelveLabs
        </li>
        <li aria-hidden>→</li>
        <li>
          <span className="font-medium text-sky-200">one campaign</span> checked by REROUTE for every channel × territory
        </li>
      </ol>
    </div>
  );
}

/** What PULSE read from the goal and what REROUTE will be asked — unknowns are shown, never guessed. */
function Understood({ goal }: { goal: GoalView }) {
  const o = goal.run.objective;
  const p = goal.run.plan;
  const chips: [string, string | undefined][] = [
    ["Goal", o.summary],
    ["Market", o.market ? o.market.label : o.scope === "GLOBAL" ? `Global (${p.territories.join(", ")})` : undefined],
    ["Product", o.product?.label],
    ["Match", goal.run.match],
    ["KPI", o.kpi],
  ];
  return (
    <div className="space-y-2 rounded-xl border border-white/8 bg-zinc-950/40 px-4 py-3 text-xs">
      <div className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">What PULSE understood</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {chips.map(([label, value]) => (
          <span key={label} className={cn("max-w-full rounded-full border px-2.5 py-0.5 break-words", value ? "border-white/10 text-zinc-200" : "border-amber-500/40 text-amber-300")}>
            <span className="text-zinc-500">{label}:</span> {value ?? "not stated"}
          </span>
        ))}
      </div>
      <p className="text-zinc-400">
        We will check rights for{" "}
        <span className="text-zinc-200">
          {p.usage.toLowerCase()} use on {p.channels.map((ch) => CHANNEL_LABEL[ch] ?? ch).join(", ")} × {p.territories.join(", ")}
        </span>{" "}
        — {p.channels.length * p.territories.length} uses, each decided separately.
      </p>
    </div>
  );
}

function MomentSkeletons() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-3" aria-hidden>
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-3 rounded-xl border border-white/10 bg-zinc-950/70 p-4">
          <Skeleton className="aspect-video w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
        </div>
      ))}
    </div>
  );
}
