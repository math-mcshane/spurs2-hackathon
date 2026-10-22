"use client";

import Link from "next/link";
import { FlaskConicalIcon, ScanSearchIcon, SearchXIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CommercialState, MediaCandidate, MediaLookup, OpportunityView, RightsState, ScoreBreakdown, SnapshotMeta, SourceMode } from "./types";
import { WEIGHTS } from "./detect-opportunities";

const tag = "rounded-sm font-mono text-[10px] tracking-wider";

const RIGHTS: Record<RightsState, { label: string; cls: string }> = {
  NOT_CHECKED: { label: "NOT CHECKED", cls: "border-zinc-500/60 bg-zinc-500/10 text-zinc-300" },
  ALLOWED: { label: "ALLOWED", cls: "border-emerald-500/50 bg-emerald-500/15 text-emerald-300" },
  BLOCKED: { label: "BLOCKED", cls: "border-red-500/60 bg-red-500/15 text-red-300" },
  NEEDS_REVIEW: { label: "NEEDS REVIEW", cls: "border-amber-500/50 bg-amber-500/15 text-amber-300" },
};

export function RightsBadge({ state, className }: { state: RightsState; className?: string }) {
  return (
    <Badge variant="outline" title="Rights state as decided by REROUTE" className={cn(tag, RIGHTS[state].cls, className)}>
      RIGHTS · {RIGHTS[state].label}
    </Badge>
  );
}

/** Product wording for REROUTE's rights state: "Rights-ready" only when REROUTE said ALLOWED. */
export const RIGHTS_MESSAGE: Record<RightsState, string> = {
  ALLOWED: "Rights-ready (REROUTE)",
  NOT_CHECKED: "Not yet checked by REROUTE",
  NEEDS_REVIEW: "Rights review required",
  BLOCKED: "Blocked by REROUTE",
};

export const RIGHTS_TEXT_CLASS: Record<RightsState, string> = {
  ALLOWED: "text-emerald-300",
  NOT_CHECKED: "text-zinc-300",
  NEEDS_REVIEW: "text-amber-300",
  BLOCKED: "text-red-300",
};

const DISCOVERED: Record<MediaCandidate["discoveredBy"], string> = { FILENAME: "filename", PLAYER_TAG: "player tag", TEAM_TAG: "team tag", INDEX_SEARCH: "index search" };

/** How a candidate was found, in product language. */
export function evidenceLabel(c: MediaCandidate): string {
  return c.foundBy === "TWELVELABS"
    ? `TwelveLabs moment #${c.rank ?? "?"} (live)`
    : `ScorePlay ${DISCOVERED[c.discoveredBy]} match · metadata only`;
}

/** User-facing media-intelligence state; technical attempts stay in a collapsed developer section. */
export function IntelligenceNote({ media, className }: { media: MediaLookup; className?: string }) {
  const s = media.intelligence.status;
  const Icon = s === "MOMENTS_FOUND" ? ScanSearchIcon : s === "UNAVAILABLE" ? TriangleAlertIcon : SearchXIcon;
  return (
    <p
      role="status"
      className={cn(
        "flex items-start gap-1.5 text-[11px]",
        s === "MOMENTS_FOUND" ? "text-sky-300" : s === "UNAVAILABLE" ? "text-amber-300" : "text-zinc-400",
        className,
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      {media.intelligence.message}
    </p>
  );
}

export const COMMERCIAL: Record<CommercialState, { label: string; cls: string; hint: string }> = {
  EDITORIAL: { label: "EDITORIAL", cls: "border-zinc-500/60 text-zinc-300", hint: "Brand/editorial suggestion — no sponsor brief" },
  FULFILLMENT_CANDIDATE: {
    label: "FULFILLMENT CANDIDATE",
    cls: "border-sky-500/50 bg-sky-500/10 text-sky-300",
    hint: "Could fulfill an existing contracted deliverable — not new revenue",
  },
  UPSELL_IDEA: {
    label: "UPSELL IDEA",
    cls: "border-violet-500/50 bg-violet-500/10 text-violet-300",
    hint: "Concept for sales review — PROPOSED / NOT SOLD",
  },
};

export function CommercialBadge({ state, className }: { state: CommercialState; className?: string }) {
  return (
    <Badge variant="outline" title={COMMERCIAL[state].hint} className={cn(tag, COMMERCIAL[state].cls, className)}>
      {COMMERCIAL[state].label}
    </Badge>
  );
}

export function SourceBadge({ mode, className }: { mode: SourceMode; className?: string }) {
  const label = mode === "FIXTURE" ? "SIMULATED · DEMO" : mode === "MANUAL" ? "PRODUCER TRIGGER" : "PUBLIC API";
  return (
    <Badge
      variant="outline"
      className={cn(tag, mode === "FIXTURE" ? "border-amber-500/70 bg-amber-500/15 text-amber-300" : "border-violet-500/50 text-violet-300", className)}
    >
      {label}
    </Badge>
  );
}

export function FictionalBriefTag({ className }: { className?: string }) {
  return (
    <Badge variant="outline" className={cn(tag, "border-amber-500/70 bg-amber-500/15 text-amber-300", className)}>
      FICTIONAL BRIEF
    </Badge>
  );
}

export const STATUS_LABEL: Record<OpportunityView["status"], string> = {
  DETECTED: "Detected",
  SENT_TO_REROUTE: "Sent to REROUTE",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  DISMISSED: "Dismissed",
};

export const DELIVERABLE_LABEL: Record<OpportunityView["deliverableState"], string | null> = {
  NONE: null,
  OPEN: "Deliverable open",
  DELIVERABLE_READY: "DELIVERABLE_READY — not fulfilled until published",
  FULFILLED: "FULFILLED — published with evidence",
};

export function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
}

export function minutes(m: number | undefined): string {
  if (m === undefined) return "—";
  return m < 120 ? `${m} min` : `${(m / 60).toFixed(1)} h`;
}

/** Click-to-expand score breakdown; the weights are shown as heuristics. */
export function ScoreDetails({ score }: { score: ScoreBreakdown }) {
  const rows = [
    ["Fan signal", score.fanSignalStrength, WEIGHTS.fanSignalStrength, score.notes.fanSignalStrength],
    ["Commercial fit", score.commercialFit, WEIGHTS.commercialFit, score.notes.commercialFit],
    ["Freshness", score.freshness, WEIGHTS.freshness, score.notes.freshness],
  ] as const;
  return (
    <details className="group text-xs">
      <summary className="cursor-pointer list-none font-mono text-[11px] text-zinc-400 hover:text-zinc-200">
        Priority <span className="text-zinc-100">{score.priority}</span>/100{" "}
        <span className="text-zinc-600 group-open:hidden">· why?</span>
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
          Hackathon heuristic weights — explanatory only, not a predictor of engagement or sales. Never overrides the REROUTE
          rights verdict.
        </p>
      </div>
    </details>
  );
}

/** Header of the fan-signal board (behind PULSE_BOARD_ENABLED). Always labeled SIMULATED: its signals are fixtures. */
export function PulseHeader({ right }: { right?: React.ReactNode }) {
  return (
    <header className="border-b border-white/8 bg-zinc-950/80 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <Link href="/" className="font-mono text-lg font-black tracking-[0.3em] text-zinc-50">
            PU<span className="text-sky-400">●</span>LSE
          </Link>
          <Badge variant="outline" className={cn(tag, "border-amber-500/70 bg-amber-500/15 text-amber-300")}>
            SIMULATED SIGNAL BOARD
          </Badge>
        </div>
        <div className="flex items-center gap-3">
          {right}
          <nav aria-label="PULSE" className="flex items-center gap-3 text-[11px]">
            <Link href="/" className="text-zinc-400 hover:text-zinc-100">
              Campaign studio
            </Link>
            <Link href="/pulse/board" className="text-zinc-400 hover:text-zinc-100" title="Fan-signal opportunity board (simulated signals)">
              Signal board
            </Link>
          </nav>
        </div>
      </div>
    </header>
  );
}

export function DemoBanner({ meta }: { meta: SnapshotMeta }) {
  if (!meta.demoLabel) return null;
  return (
    <div
      role="note"
      aria-label="Simulated fan signals"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-amber-500/40 bg-amber-500/15 px-4 py-1.5 text-xs text-amber-200"
    >
      <FlaskConicalIcon className="size-4 text-amber-400" aria-hidden />
      <strong className="font-mono tracking-[0.2em] text-amber-300">{meta.demoLabel}</strong>
      <span className="text-amber-200/80">{meta.demoDisclaimer}</span>
      {meta.replayClock && <span className="font-mono text-[10px] text-amber-300/80">replay clock {when(meta.replayClock)}</span>}
    </div>
  );
}
