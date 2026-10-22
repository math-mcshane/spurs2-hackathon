"use client";

import { AlertTriangleIcon, KeyRoundIcon, OctagonXIcon } from "lucide-react";
import { DEMO_CLEARANCE_LABEL, type Clearance, type DataOrigin, type Evidence, type Verdict } from "@/lib/contracts";
import { describeError } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/** Seconds → `m:ss.s` broadcast-style timecode. */
export function tc(sec: number | undefined): string {
  if (sec === undefined || !Number.isFinite(sec)) return "—";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}

export function tcRange(start?: number, end?: number): string {
  if (start === undefined && end === undefined) return "whole asset";
  return `${tc(start)}–${tc(end)}`;
}

export const VERDICT_STYLE: Record<Verdict, { label: string; text: string; bg: string; border: string; fill: string }> = {
  ALLOWED: {
    label: "ALLOWED",
    text: "text-emerald-300",
    bg: "bg-emerald-500/15",
    border: "border-emerald-500/50",
    fill: "bg-emerald-500/70",
  },
  BLOCKED: {
    label: "BLOCKED",
    text: "text-red-300",
    bg: "bg-red-500/15",
    border: "border-red-500/60",
    fill: "bg-red-500/80",
  },
  NEEDS_REVIEW: {
    label: "NEEDS REVIEW",
    text: "text-amber-300",
    bg: "bg-amber-500/15",
    border: "border-amber-500/50",
    fill: "bg-amber-500/70",
  },
};

/** ALLOWED under DEMO clearance is never shown green: it is not a verified legal clearance. */
export function VerdictBadge({ verdict, clearance, className }: { verdict: Verdict; clearance?: Clearance; className?: string }) {
  const demo = verdict === "ALLOWED" && clearance === "DEMO";
  const s = VERDICT_STYLE[verdict];
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-sm font-mono text-[10px] tracking-wider",
        demo ? "border-amber-500/60 bg-amber-500/15 text-amber-200" : `${s.text} ${s.bg} ${s.border}`,
        className,
      )}
    >
      {demo ? "ALLOWED · DEMO" : s.label}
    </Badge>
  );
}

const ORIGIN_STYLE: Record<DataOrigin, string> = {
  LIVE: "border-sky-500/50 bg-sky-500/10 text-sky-300",
  CACHED: "border-zinc-500/60 bg-zinc-500/10 text-zinc-300",
  HUMAN: "border-violet-500/50 bg-violet-500/10 text-violet-300",
};

/** Data provenance badge. `undefined` is rendered as "ORIGIN ?" — never assumed LIVE. */
export function OriginBadge({ origin, className }: { origin: DataOrigin | undefined; className?: string }) {
  return (
    <Badge
      variant="outline"
      title={origin ? `Data origin: ${origin}` : "Data origin not reported by the server"}
      className={cn(
        "rounded-sm font-mono text-[10px] tracking-wider",
        origin ? ORIGIN_STYLE[origin] : "border-zinc-600 text-zinc-400",
        className,
      )}
    >
      {origin ?? "ORIGIN ?"}
    </Badge>
  );
}

export function evidenceOrigin(e: Evidence): DataOrigin | undefined {
  return e.origin ?? (e.source === "HUMAN" ? "HUMAN" : undefined);
}

export function FictionalTag({ className }: { className?: string }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "rounded-sm border-amber-500/70 bg-amber-500/15 font-mono text-[10px] tracking-wider text-amber-300",
        className,
      )}
    >
      {DEMO_CLEARANCE_LABEL}
    </Badge>
  );
}

/** Inline error state for an API failure. `service` names the integration behind the call. */
export function ErrorState({
  error,
  service,
  className,
}: {
  error: unknown;
  service?: "ScorePlay" | "TwelveLabs" | "Media processing" | "Policy";
  className?: string;
}) {
  const d = describeError(error);
  const notConfigured = d.code === "NOT_CONFIGURED";
  const forbidden = d.code === "FORBIDDEN";
  const Icon = notConfigured ? KeyRoundIcon : forbidden ? OctagonXIcon : AlertTriangleIcon;
  const title =
    service === "Media processing" && (notConfigured || forbidden)
      ? "Media processing not approved"
      : notConfigured && service
        ? service === "Policy" ? "Policy not configured" : `${service} key not configured`
        : d.title;
  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        notConfigured
          ? "border-amber-500/40 bg-amber-500/5 text-amber-200"
          : "border-red-500/40 bg-red-500/5 text-red-200",
        className,
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <div className="font-medium">
          {title} <span className="font-mono text-[10px] opacity-60">[{d.code}]</span>
        </div>
        <div className="break-words opacity-80">{d.detail}</div>
      </div>
    </div>
  );
}

export function PanelTitle({ step, children, right }: { step: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-white/5 px-3 py-2">
      <h2 className="flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-zinc-300 uppercase">
        <span className="font-mono text-[10px] text-zinc-500">{step}</span>
        {children}
      </h2>
      {right}
    </div>
  );
}

export function Panel({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-lg border border-white/8 bg-zinc-900/60 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]", className)}
      {...props}
    >
      {children}
    </section>
  );
}
