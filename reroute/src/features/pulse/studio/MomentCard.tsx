"use client";

import { ArrowRightIcon, CheckIcon, Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RANKING, clock } from "../moment-ranking";
import type { RecommendationView } from "../types";
import { MomentPreview } from "./MomentPreview";
import { RightsPill } from "./parts";

/** Filename without extension, separators as spaces: what a social manager recognizes. */
export function displayTitle(title: string): string {
  return title.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

export function MomentCard({
  rec,
  position,
  selected,
  busy,
  onChoose,
}: {
  rec: RecommendationView;
  position: number;
  selected: boolean;
  busy: boolean;
  onChoose: () => void;
}) {
  const c = rec.candidate;
  return (
    <article
      className={cn(
        "flex flex-col overflow-hidden rounded-xl border bg-zinc-950/70 transition-colors",
        selected ? "border-sky-400/70 ring-1 ring-sky-400/40" : "border-white/10 hover:border-white/20",
      )}
    >
      <MomentPreview key={rec.key} rec={rec} className="rounded-none border-0 border-b border-white/10" />
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-mono text-[10px] tracking-[0.18em] text-sky-300 uppercase">Moment {position}</div>
            <h3 className="truncate text-base font-semibold text-zinc-50" title={c.title}>
              {displayTitle(c.title)}
            </h3>
            <p className="font-mono text-[11px] text-zinc-500">
              {clock(c.startSeconds ?? 0)}–{clock(c.endSeconds ?? 0)}
              {c.durationSec !== undefined && ` of ${clock(c.durationSec)}`}
              {rec.season && ` · ${rec.season}`}
            </p>
          </div>
          <RightsPill rights={rec.rights} />
        </div>

        <div className="flex flex-wrap gap-1">
          {rec.matches.map((m) => (
            <span key={m.intent} className="rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[11px] text-sky-200">
              {m.label} <span className="font-mono text-sky-400/80">#{m.rank}</span>
            </span>
          ))}
        </div>

        <dl className="space-y-2 text-xs">
          <div>
            <dt className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Why this opportunity</dt>
            <dd className="text-zinc-200">{rec.why.opportunity}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Why this media</dt>
            <dd className="text-zinc-300">{rec.why.media}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">What you can do</dt>
            <dd className="text-zinc-300">{rec.why.action}</dd>
          </div>
        </dl>

        <details className="text-[11px] text-zinc-500">
          <summary className="cursor-pointer hover:text-zinc-300">Scoring details</summary>
          <div className="mt-1.5 space-y-1 rounded-md border border-white/8 bg-black/30 p-2 font-mono">
            <p>
              score {rec.score} = ({RANKING.relevance} × relevance {rec.breakdown.relevance} + {RANKING.readiness} × readiness {rec.breakdown.readiness}) ×{" "}
              {rec.breakdown.contextFactor}
            </p>
            <p className="font-sans">{rec.breakdown.notes.relevance}</p>
            <p className="font-sans">{rec.breakdown.notes.readiness}</p>
            <p className="font-sans">{rec.breakdown.notes.context}</p>
            <p className="font-sans text-zinc-600">
              ScorePlay {c.scoreplayAssetId} · TwelveLabs {c.twelveLabsVideoId}
              {c.mapping?.via === "FILENAME_DURATION" && " · linked by exact filename + duration"}
            </p>
          </div>
        </details>

        <Button className="mt-auto w-full" variant={selected ? "outline" : "default"} disabled={busy} onClick={onChoose}>
          {busy ? <Loader2Icon className="animate-spin" /> : selected ? <CheckIcon /> : <ArrowRightIcon />}
          {selected ? "In your campaign" : "Build campaign with this moment"}
        </Button>
      </div>
    </article>
  );
}
