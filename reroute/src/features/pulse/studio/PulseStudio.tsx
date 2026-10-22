"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2Icon, SearchXIcon, SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { ErrorState } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import { CLUBS } from "../clubs";
import { pulseApi } from "../client";
import { PulseHeader } from "../pulse-ui";
import type { Club, GoalAction, GoalView } from "../types";
import { CampaignStage, type Busy } from "./CampaignStage";
import { MomentCard } from "./MomentCard";
import { StepHeading } from "./parts";

const EXAMPLES: Record<Club, string[]> = {
  tottenham: [
    "Promote Tottenham merchandise to UK fans using the best moments from the Manchester United match.",
    "Maximize global engagement from the Manchester United match.",
  ],
  spurs: ["Sell Spurs jerseys in Mexico using the best moments from the Kings game."],
};

const VERDICT_TOAST: Record<"ALLOWED" | "NEEDS_REVIEW" | "BLOCKED", string> = {
  ALLOWED: "REROUTE: ALLOWED",
  NEEDS_REVIEW: "REROUTE: needs a rights review",
  BLOCKED: "REROUTE: blocked for this use",
};

const NEXT_SECTION: Partial<Record<GoalAction["action"], string>> = { run: "s-opps", draft: "s-campaign", findAlternatives: "s-recovery" };

/**
 * PULSE's default experience: one goal → three real moments → one campaign proposal, with REROUTE's
 * rights verdict and a "Find another way" recovery that keeps the goal. Technical detail stays folded.
 */
export function PulseStudio() {
  const [goal, setGoal] = useState<GoalView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<unknown>(null);
  const [text, setText] = useState("");
  const [club, setClub] = useState<Club>("tottenham");
  /** Section to bring into view once the action's result has rendered. */
  const scrollTo = useRef<string | null>(null);

  useEffect(() => {
    if (!scrollTo.current) return;
    document.getElementById(scrollTo.current)?.scrollIntoView({ behavior: "smooth", block: "start" });
    scrollTo.current = null;
  }, [goal]);

  useEffect(() => {
    let live = true;
    const id = new URLSearchParams(window.location.search).get("goal") ?? undefined;
    pulseApi.goal(id).then(
      (g) => {
        if (!live) return;
        setGoal(g);
        if (g) {
          setText(g.run.objective.raw);
          setClub(g.run.club);
        }
        setLoaded(true);
      },
      (err) => {
        if (!live) return;
        setError(err);
        setLoaded(true);
      },
    );
    return () => {
      live = false;
    };
  }, []);

  async function act(body: GoalAction, kind: Exclude<Busy, null>, done?: (g: GoalView) => void) {
    setBusy(kind);
    try {
      const g = await pulseApi.goalAction(body);
      scrollTo.current = body.action === "draft" && body.commerceUrl ? null : (NEXT_SECTION[body.action] ?? null);
      setGoal(g);
      setError(null);
      window.history.replaceState(null, "", `/pulse?goal=${g.run.id}`);
      done?.(g);
    } catch (err) {
      setError(err);
      // A refused approval still records REROUTE's fresh verdict: show it.
      if (goal && body.action !== "run") await pulseApi.goal(goal.run.id).then(setGoal, () => undefined);
    } finally {
      setBusy(null);
    }
  }

  const id = goal?.run.id;
  const verdictToast = (g: GoalView) => {
    const rights = g.campaign?.rights;
    if (rights && rights.state !== "NOT_CHECKED") toast.info(rights.cleared ? "REROUTE: cleared for this use" : VERDICT_TOAST[rights.state]);
  };

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.08),transparent_60%)]">
      <PulseHeader />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-4 py-6">
        {/* 1 · Goal */}
        <section aria-labelledby="s-goal" className="space-y-3">
          <div id="s-goal">
            <StepHeading n={1} active={!goal} title="What do you want to achieve?" sub="Describe the business goal in your own words — market, product and match." />
          </div>
          <form
            className="space-y-2 rounded-xl border border-white/10 bg-zinc-950/60 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ action: "run", goal: text, club }, "run", (g) => {
                if (g.recommendations.length) toast.success(`${g.recommendations.length} moments found for “${g.run.objective.summary}”`);
                else toast.warning("No moment to recommend for this goal yet");
              });
            }}
          >
            <Label htmlFor="goal-text" className="sr-only">
              Business goal
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
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="goal-club" className="text-[11px] text-zinc-500">
                Club
              </Label>
              <select
                id="goal-club"
                value={club}
                onChange={(e) => setClub(e.target.value === "spurs" ? "spurs" : "tottenham")}
                className="h-8 rounded-lg border border-input bg-input/30 px-2 text-xs"
              >
                {Object.entries(CLUBS).map(([k, c]) => (
                  <option key={k} value={k}>
                    {c.label}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-zinc-500">Try:</span>
              {EXAMPLES[club].map((ex) => (
                <button
                  key={ex}
                  type="button"
                  onClick={() => setText(ex)}
                  className="max-w-full truncate rounded-full border border-white/10 px-2.5 py-0.5 text-[11px] text-zinc-300 hover:border-sky-500/50 hover:text-sky-200"
                >
                  {ex}
                </button>
              ))}
              <Button type="submit" size="lg" className="ml-auto" disabled={busy !== null || text.trim().length < 3}>
                {busy === "run" ? <Loader2Icon className="animate-spin" /> : <SparklesIcon />}
                Find the best moments
              </Button>
            </div>
            {busy === "run" && (
              <p role="status" className="text-xs text-sky-300">
                Searching the {CLUBS[club].label} library in ScorePlay and asking TwelveLabs for moments that serve this goal…
              </p>
            )}
          </form>
          {goal && <Understood goal={goal} />}
        </section>

        {error !== null && <ErrorState error={error} />}
        {!loaded && (
          <p className="flex items-center gap-2 text-sm text-zinc-400">
            <Loader2Icon className="size-4 animate-spin" /> Loading…
          </p>
        )}

        {/* 2 · Opportunity */}
        {goal && (
          <section aria-labelledby="s-opps" className="space-y-3">
            <div id="s-opps">
              <StepHeading
                n={2}
                active={!goal.campaign}
                title={goal.recommendations.length ? `Your best ${goal.recommendations.length === 1 ? "moment" : `${goal.recommendations.length} moments`}` : "No moment to recommend"}
                sub={goal.run.search.message}
              />
            </div>
            {goal.recommendations.length === 0 ? (
              <p className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-100">
                <SearchXIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>
                  PULSE never fills the gap with invented clips.
                  {goal.run.search.status === "NOT_INDEXED"
                    ? " Index this club's footage in TwelveLabs (or set PULSE_TWELVELABS_INDEX_ID_<CLUB>) and run the goal again."
                    : goal.run.search.status === "UNAVAILABLE"
                      ? " Try again in a moment; the technical detail is under “How PULSE searched”."
                      : " Try a goal with a different product or market."}
                </span>
              </p>
            ) : (
              <div className="grid gap-4 md:grid-cols-3">
                {goal.recommendations.map((rec, i) => (
                  <MomentCard
                    key={rec.key}
                    rec={rec}
                    position={i + 1}
                    selected={goal.run.selectedKey === rec.key}
                    busy={busy !== null}
                    onChoose={() => id && void act({ action: "draft", id, key: rec.key }, `draft:${rec.key}`, () => toast.success("Campaign proposal ready"))}
                  />
                ))}
              </div>
            )}
            <SearchDetails goal={goal} />
          </section>
        )}

        {/* 3 · Campaign */}
        {goal?.campaign && goal.selected && id && (
          <CampaignStage
            goal={goal}
            campaign={goal.campaign}
            rec={goal.selected}
            busy={busy}
            onCheckRights={() => void act({ action: "checkRights", id }, "rights", verdictToast)}
            onFindAlternatives={() =>
              void act({ action: "findAlternatives", id }, "alternatives", (g) =>
                toast.info(g.recovery?.exhausted && !g.recovery.groups.UNCHECKED.length ? "REROUTE has evaluated every moment found for this goal" : "REROUTE evaluated the next-best moments"),
              )
            }
            onUse={(key, commerceUrl) => void act({ action: "draft", id, key, commerceUrl }, `draft:${key}`, () => toast.success("Campaign updated — same goal"))}
            onApprove={(reviewer) => void act({ action: "approve", id, reviewer }, "approve", () => toast.success("Approved"))}
          />
        )}
      </main>
      <footer className="px-4 pb-4 text-center text-[10px] text-zinc-600">
        PULSE recommends and drafts; it never publishes, buys ads or decides rights. Rights verdicts come only from REROUTE. Moments come
        live from ScorePlay and TwelveLabs — no simulated signals are used in this flow.
      </footer>
    </div>
  );
}

function Understood({ goal }: { goal: GoalView }) {
  const o = goal.run.objective;
  const chips: [string, string | undefined][] = [
    ["Goal", o.summary],
    ["Market", o.market ? o.market.label : o.scope === "GLOBAL" ? "Global" : undefined],
    ["Product", o.product?.label],
    ["Match", goal.run.match],
    ["Primary KPI", o.kpi],
  ];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="text-[11px] text-zinc-500">PULSE understood:</span>
      {chips.map(([label, value]) => (
        <span key={label} className={cn("rounded-full border px-2.5 py-0.5", value ? "border-white/10 text-zinc-200" : "border-amber-500/40 text-amber-300")}>
          <span className="text-zinc-500">{label}:</span> {value ?? "not stated"}
        </span>
      ))}
    </div>
  );
}

function SearchDetails({ goal }: { goal: GoalView }) {
  const r = goal.run;
  return (
    <details className="rounded-lg border border-white/8 bg-zinc-950/40 px-3 py-2 text-[11px] text-zinc-500">
      <summary className="cursor-pointer hover:text-zinc-300">How PULSE searched</summary>
      <div className="mt-2 space-y-2">
        <p>
          Library: {r.library.videos} {CLUBS[r.club].label} videos in ScorePlay, {r.library.indexed} in TwelveLabs index{" "}
          {r.library.indexName ?? "—"}. Results in {goal.timing.toRecommendationsSec.toFixed(1)} s.
        </p>
        <table className="w-full text-left">
          <thead className="text-zinc-400">
            <tr>
              <th className="py-0.5 pr-2 font-medium">Question for this goal</th>
              <th className="py-0.5 pr-2 font-medium">Weight</th>
              <th className="py-0.5 font-medium">Why it matters</th>
            </tr>
          </thead>
          <tbody>
            {r.intents.map((i) => (
              <tr key={i.key} className="border-t border-white/5 align-top">
                <td className="py-1 pr-2 text-zinc-300">“{i.query}”</td>
                <td className="py-1 pr-2 font-mono">{i.weight}</td>
                <td className="py-1">{i.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="space-y-0.5 font-mono text-[10px]">
          {r.attempts.map((a, i) => (
            <li key={i}>
              {a.service} “{a.query}” → {a.outcome}
              {a.code && ` [${a.code}]`}
              {a.detail && <span className="text-zinc-600"> · {a.detail}</span>}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
