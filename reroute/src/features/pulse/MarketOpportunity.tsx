"use client";

import { useState } from "react";
import { GlobeIcon, Loader2Icon, TargetIcon, XIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { MARKET_FIXTURE } from "./market-signals";
import { MARKET_WEIGHTS } from "./objective-ranker";
import { when } from "./pulse-ui";
import type { Level, MarketAnalysis, MarketFit, ParsedObjective, RankingComparison as RankingComparisonData } from "./types";

const EXAMPLES = ["Sell jerseys in Mexico", "Maximize global engagement", "Grow followers in France by the end of December"];

const FIT: Record<MarketFit["label"], { text: string; cls: string }> = {
  STRONG: { text: "Strong market fit", cls: "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" },
  POSSIBLE: { text: "Possible fit", cls: "border-sky-500/50 bg-sky-500/10 text-sky-300" },
  WEAK: { text: "Weak fit", cls: "border-zinc-500/60 text-zinc-400" },
  NO_MARKET_DATA: { text: "No market data", cls: "border-amber-500/50 bg-amber-500/10 text-amber-300" },
};

const LEVEL_CLS: Record<Level, string> = {
  HIGH: "text-emerald-300",
  MEDIUM: "text-sky-300",
  LOW: "text-zinc-300",
  NONE: "text-zinc-500",
};

export function FitBadge({ fit, className }: { fit: MarketFit; className?: string }) {
  return (
    <Badge variant="outline" className={cn("rounded-sm font-mono text-[10px] tracking-wider", FIT[fit.label].cls, className)}>
      {FIT[fit.label].text.toUpperCase()} · {fit.score}
    </Badge>
  );
}

/** Objective input + what the parser understood. */
export function ObjectivePanel({
  objective,
  busy,
  onSet,
  onClear,
}: {
  objective?: ParsedObjective;
  busy: boolean;
  onSet: (text: string) => Promise<boolean>;
  onClear: () => void;
}) {
  const [text, setText] = useState("");
  const field = (label: string, value: string | undefined, matched?: string) => (
    <div className="rounded-md border border-white/8 bg-black/30 px-2 py-1.5">
      <div className="text-[9px] tracking-[0.18em] text-zinc-500 uppercase">{label}</div>
      <div className={cn("text-xs", value ? "text-zinc-100" : "text-amber-300")}>{value ?? "not stated"}</div>
      {matched && <div className="font-mono text-[9px] text-zinc-600">from “{matched}”</div>}
    </div>
  );
  return (
    <section aria-labelledby="p-objective" className="rounded-lg border border-sky-500/30 bg-sky-500/[0.04]">
      <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
        <h2 id="p-objective" className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-sky-200 uppercase">
          <TargetIcon className="size-3.5" aria-hidden /> Business objective → market opportunity
        </h2>
        {objective && (
          <Button size="xs" variant="ghost" disabled={busy} onClick={onClear}>
            <XIcon /> Clear objective
          </Button>
        )}
      </div>
      <div className="space-y-3 p-3">
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onSet(text)) setText("");
          }}
        >
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={objective ? objective.raw : EXAMPLES[0]}
            aria-label="Business objective"
            minLength={3}
            maxLength={280}
            className="h-9 text-sm"
          />
          <Button type="submit" disabled={busy || text.trim().length < 3}>
            {busy ? <Loader2Icon className="animate-spin" /> : <TargetIcon />}
            Find opportunities
          </Button>
        </form>
        {!objective && (
          <div className="flex flex-wrap gap-1.5 text-[11px]">
            <span className="text-zinc-500">Try:</span>
            {EXAMPLES.map((ex) => (
              <button key={ex} type="button" onClick={() => setText(ex)} className="rounded border border-white/10 px-1.5 py-0.5 text-zinc-300 hover:border-sky-500/50">
                {ex}
              </button>
            ))}
          </div>
        )}
        {objective && (
          <>
            <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {field("Objective", objective.summary)}
              {field(
                "Market",
                objective.market
                  ? `${objective.market.label} (${objective.market.code})`
                  : objective.scope === "GLOBAL"
                    ? "Global — no single territory"
                    : undefined,
                objective.market?.matched,
              )}
              {field("Product", objective.product?.label, objective.product?.matched)}
              {field("KPI", objective.kpi)}
              {field("Deadline", objective.deadline && (objective.deadline.iso ? when(objective.deadline.iso) : objective.deadline.text), objective.deadline?.text)}
              {field("Club", objective.club === "tottenham" ? "Tottenham Hotspur" : objective.club === "spurs" ? "San Antonio Spurs" : "all clubs")}
            </div>
            <p className="text-[11px] text-zinc-500">
              <strong className="text-amber-300">KPI measurement: {objective.measurement.status.replaceAll("_", " ").toLowerCase()}.</strong>{" "}
              {objective.measurement.note}
            </p>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
              <GlobeIcon className="size-3.5 text-amber-400" aria-hidden />
              <strong className="font-mono tracking-[0.15em] text-amber-300">{MARKET_FIXTURE.label}</strong>
              <span className="text-amber-200/80">{MARKET_FIXTURE.disclaimer}</span>
              <span className="text-amber-200/60">{MARKET_FIXTURE.geographyBasis}</span>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function Stat({ label, level, detail }: { label: string; level: Level; detail?: string }) {
  return (
    <div className="rounded-md border border-white/8 bg-black/30 px-2 py-1.5">
      <div className="text-[9px] tracking-[0.18em] text-zinc-500 uppercase">{label}</div>
      <div className={cn("font-mono text-sm font-semibold", LEVEL_CLS[level])}>{level.charAt(0) + level.slice(1).toLowerCase()}</div>
      {detail && <div className="font-mono text-[10px] text-zinc-500">{detail}</div>}
    </div>
  );
}

/** The card body while an objective is active (replaces the generic interest summary). */
export function MarketBlock({ fit, compact = false }: { fit: MarketFit; compact?: boolean }) {
  const a = fit.analysis;
  return (
    <div className="space-y-2 rounded-md border border-sky-500/25 bg-sky-500/[0.04] p-2">
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <span className="font-mono text-[9px] tracking-[0.18em] text-sky-300/80 uppercase">
          PULSE — market opportunity{a?.mode === "FIXTURE" && " · simulated"}
        </span>
        <FitBadge fit={fit} />
      </div>
      {a ? (
        <div className="grid grid-cols-2 gap-1.5">
          <Stat label="Global interest" level={a.globalInterest} detail={`${a.globalCurrent.toLocaleString("en-US")} / week`} />
          <Stat label={`${a.market.label} momentum`} level={a.momentum} detail={`${a.lift}× usual · ${a.current} / week`} />
        </div>
      ) : (
        <p className="text-[11px] text-amber-300">{fit.notes.localInterest}</p>
      )}
      <dl className="space-y-1 text-[11px]">
        <div>
          <dt className="inline text-zinc-500">Business objective: </dt>
          <dd className="inline text-zinc-200">{fit.objective}</dd>
        </div>
        {!compact && (
          <div>
            <dt className="inline text-zinc-500">Proposed content: </dt>
            <dd className="inline text-zinc-200">{fit.proposedContent}</dd>
          </div>
        )}
        <div>
          <dt className="text-zinc-500">Why PULSE recommends it</dt>
          <dd className="text-zinc-300">{fit.why}</dd>
        </div>
        <div>
          <dt className="inline text-zinc-500">Next action: </dt>
          <dd className="inline text-sky-200">{fit.nextAction}</dd>
        </div>
      </dl>
    </div>
  );
}

export function MarketScoreDetails({ fit }: { fit: MarketFit }) {
  const rows = [
    ["Local interest", fit.localInterest, MARKET_WEIGHTS.localInterest, fit.notes.localInterest],
    ["Objective fit", fit.objectiveFit, MARKET_WEIGHTS.objectiveFit, fit.notes.objectiveFit],
    ["Media in ScorePlay", fit.mediaAvailability, MARKET_WEIGHTS.mediaAvailability, fit.notes.mediaAvailability],
  ] as const;
  return (
    <details className="group text-xs">
      <summary className="cursor-pointer list-none font-mono text-[11px] text-zinc-400 hover:text-zinc-200">
        Market score <span className="text-zinc-100">{fit.score}</span>/100 <span className="text-zinc-600 group-open:hidden">· why?</span>
      </summary>
      <div className="mt-2 space-y-1.5 rounded-md border border-white/8 bg-black/30 p-2">
        {rows.map(([label, value, weight, note]) => (
          <div key={label}>
            <div className="flex justify-between font-mono text-[11px]">
              <span className="text-zinc-300">
                {label} <span className="text-zinc-600">× {weight}</span>
              </span>
              <span className="text-zinc-100">{value}</span>
            </div>
            <div className="text-[11px] text-zinc-500">{note}</div>
          </div>
        ))}
        <p className="border-t border-white/5 pt-1.5 text-[10px] text-zinc-500">
          Heuristic weights, not a sales forecast. The REROUTE rights verdict still ranks first.
        </p>
      </div>
    </details>
  );
}

/** Detail page: the market comparison and its provenance. */
export function MarketEvidence({ analysis }: { analysis: MarketAnalysis }) {
  const a = analysis;
  const rows: [string, string, string][] = [
    [`${a.market.label} (${a.market.code})`, a.current.toLocaleString("en-US"), a.baseline.toLocaleString("en-US")],
    ["Global", a.globalCurrent.toLocaleString("en-US"), a.globalBaseline.toLocaleString("en-US")],
    [`${a.market.code} share`, `${(a.shareNow * 100).toFixed(1)}%`, `${(a.shareUsual * 100).toFixed(1)}%`],
  ];
  return (
    <div className="space-y-2 rounded-md border border-sky-500/25 bg-sky-500/[0.04] p-2 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold tracking-[0.18em] text-sky-200 uppercase">Market signal</span>
        {a.mode === "FIXTURE" && (
          <Badge variant="outline" className="rounded-sm border-amber-500/70 bg-amber-500/15 font-mono text-[9px] text-amber-300">
            SIMULATED
          </Badge>
        )}
      </div>
      <table className="w-full font-mono text-[11px]">
        <thead>
          <tr className="text-zinc-500">
            <th className="text-left font-normal">mentions / week</th>
            <th className="text-right font-normal">this week</th>
            <th className="text-right font-normal">usual</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, now, usual]) => (
            <tr key={k} className="text-zinc-200">
              <td>{k}</td>
              <td className="text-right">{now}</td>
              <td className="text-right text-zinc-400">{usual}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="font-mono text-[10px] text-zinc-400">
        lift {a.lift}× · z = {a.z} · momentum {a.momentum} · global interest {a.globalInterest} · confidence {a.confidence}
        {a.underTheRadar && <span className="text-emerald-300"> · under the radar</span>}
      </p>
      <p className="text-[10px] text-zinc-500">
        Window {when(a.window.from)} → {when(a.window.to)} vs the previous {MARKET_FIXTURE.baselineWeeks} weeks. Confidence is that the
        shift is real, not that it will sell anything.
      </p>
      {a.samples.length > 0 && (
        <ul className="space-y-1">
          {a.samples.map((s) => (
            <li key={s.id} className="rounded border border-white/8 bg-black/30 px-2 py-1">
              <span className="text-zinc-200">“{s.text}”</span>
              <span className="block font-mono text-[9px] text-zinc-500">
                {s.id} · lang {s.lang} · {when(s.postedAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[10px] text-zinc-500">
        Sources: {a.sources.join("; ")}. {a.geographyBasis}
      </p>
    </div>
  );
}

/** The same opportunities ranked under preset objectives — shows the order depends on the objective. */
export function RankingComparison({ comparison, onUse }: { comparison: RankingComparisonData; onUse: (objective: string) => void }) {
  return (
    <section aria-labelledby="p-compare" className="rounded-lg border border-white/8 bg-zinc-900/60">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
        <h2 id="p-compare" className="text-[11px] font-semibold tracking-[0.18em] text-zinc-300 uppercase">
          Same footage, different objective → different ranking
        </h2>
        <span className="text-[10px] text-zinc-500">
          score = {MARKET_WEIGHTS.localInterest} market interest + {MARKET_WEIGHTS.objectiveFit} objective fit + {MARKET_WEIGHTS.mediaAvailability} media ·
          simulated signals · rights gate not applied here
        </span>
      </div>
      <div className="grid gap-3 p-3 md:grid-cols-2">
        {comparison.map((c) => (
          <div key={c.objective} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-100">“{c.objective}”</span>
              <Button size="xs" variant="ghost" onClick={() => onUse(c.objective)}>
                Use this objective
              </Button>
            </div>
            <ol className="space-y-0.5">
              {c.ranked.map((r, i) => (
                <li key={r.id} className="grid grid-cols-[1.5rem_1fr_auto] items-center gap-2 text-[11px]">
                  <span className="font-mono text-zinc-500">#{i + 1}</span>
                  <span className={cn("truncate", i === 0 ? "text-zinc-100" : "text-zinc-400")}>{r.headline}</span>
                  <span className={cn("rounded-sm border px-1 font-mono text-[10px]", FIT[r.label].cls)}>{r.score}</span>
                </li>
              ))}
            </ol>
          </div>
        ))}
      </div>
    </section>
  );
}
