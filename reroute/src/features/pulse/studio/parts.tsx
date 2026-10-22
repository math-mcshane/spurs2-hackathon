"use client";

import { CheckIcon, OctagonXIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldQuestionIcon, TriangleAlertIcon } from "lucide-react";
import { DEMO_CLEARANCE_LABEL, type Clearance } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import type { RightsState } from "../types";

type Tone = "neutral" | "review" | "blocked" | "cleared" | "demo";

/** "cleared" (green) only for ALLOWED under VERIFIED clearance; ALLOWED under a demo policy is never green. */
export function rightsTone(state: RightsState, clearance?: Clearance): Tone {
  if (state === "ALLOWED") return clearance === "VERIFIED" ? "cleared" : "demo";
  return state === "BLOCKED" ? "blocked" : state === "NEEDS_REVIEW" ? "review" : "neutral";
}

export const TONE: Record<Tone, { pill: string; panel: string; text: string; label: string; Icon: typeof ShieldCheckIcon }> = {
  neutral: { pill: "border-zinc-600 bg-zinc-800/60 text-zinc-300", panel: "border-white/10 bg-zinc-900/60", text: "text-zinc-200", label: "Not checked", Icon: ShieldQuestionIcon },
  review: { pill: "border-amber-500/50 bg-amber-500/15 text-amber-200", panel: "border-amber-500/40 bg-amber-500/[0.07]", text: "text-amber-200", label: "Needs review", Icon: ShieldAlertIcon },
  blocked: { pill: "border-red-500/60 bg-red-500/15 text-red-200", panel: "border-red-500/40 bg-red-500/[0.07]", text: "text-red-200", label: "Blocked", Icon: OctagonXIcon },
  cleared: { pill: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200", panel: "border-emerald-500/40 bg-emerald-500/[0.07]", text: "text-emerald-200", label: "Allowed", Icon: ShieldCheckIcon },
  demo: { pill: "border-amber-400/60 bg-amber-400/15 text-amber-100", panel: "border-amber-400/50 bg-amber-400/[0.07]", text: "text-amber-100", label: "Allowed · demo policy", Icon: ShieldQuestionIcon },
};

/** One-word verdict a user can read at a glance. */
export const VERDICT_WORD: Record<RightsState, string> = {
  NOT_CHECKED: "NOT CHECKED",
  ALLOWED: "ALLOWED",
  BLOCKED: "BLOCKED",
  NEEDS_REVIEW: "NEEDS REVIEW",
};

export function RightsPill({ state, clearance, className }: { state: RightsState; clearance?: Clearance; className?: string }) {
  const t = TONE[rightsTone(state, clearance)];
  return (
    <span
      title="Rights state as decided by REROUTE"
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", t.pill, className)}
    >
      <t.Icon className="size-3" aria-hidden /> {t.label}
    </span>
  );
}

/** The prominent amber label every demo-policy verdict carries. */
export function DemoPolicyBadge({ label = DEMO_CLEARANCE_LABEL, className }: { label?: string; className?: string }) {
  return (
    <span
      role="note"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border border-amber-400/70 bg-amber-400/20 px-2 py-1 font-mono text-[11px] font-semibold tracking-wide text-amber-200",
        className,
      )}
    >
      <TriangleAlertIcon className="size-3.5 shrink-0" aria-hidden /> {label}
    </span>
  );
}

export type StepKey = "goal" | "moment" | "proposal" | "rights" | "review" | "receipt";
export type StepState = "done" | "current" | "todo";

export const STEPS: { key: StepKey; label: string }[] = [
  { key: "goal", label: "Goal" },
  { key: "moment", label: "Moment" },
  { key: "proposal", label: "Proposal" },
  { key: "rights", label: "Rights" },
  { key: "review", label: "Review" },
  { key: "receipt", label: "Receipt" },
];

/** Where the user is in the journey; each item jumps to its section. */
export function Stepper({ states }: { states: Record<StepKey, StepState> }) {
  return (
    <nav aria-label="Progress">
      <ol className="flex items-center gap-1 overflow-x-auto text-[11px] sm:gap-1.5">
        {STEPS.map((s, i) => {
          const st = states[s.key];
          return (
            <li key={s.key} className="flex shrink-0 items-center gap-1 sm:gap-1.5">
              {i > 0 && <span className={cn("h-px w-2 sm:w-4", st === "todo" ? "bg-white/15" : "bg-sky-400")} aria-hidden />}
              <a
                href={`#s-${s.key}`}
                aria-current={st === "current" ? "step" : undefined}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 transition-colors",
                  st === "done" && "border-sky-500/40 text-sky-300 hover:bg-sky-500/10",
                  st === "current" && "border-sky-400 bg-sky-500/15 font-semibold text-sky-100",
                  st === "todo" && "pointer-events-none border-white/10 text-zinc-500",
                )}
              >
                {st === "done" ? <CheckIcon className="size-3" aria-hidden /> : <span className="font-mono">{i + 1}</span>}
                {s.label}
                <span className="sr-only">{st === "done" ? " (done)" : st === "current" ? " (current step)" : " (not started)"}</span>
              </a>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function StepHeading({ id, n, title, sub, active }: { id: string; n: number; title: string; sub?: React.ReactNode; active: boolean }) {
  return (
    <div className="flex scroll-mt-24 items-start gap-3" id={id}>
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-sm",
          active ? "border-sky-400 bg-sky-500/15 text-sky-100" : "border-white/15 text-zinc-500",
        )}
        aria-hidden
      >
        {n}
      </span>
      <div className="min-w-0">
        <h2 className="text-lg font-semibold text-zinc-50">{title}</h2>
        {sub && <div className="text-xs text-zinc-400">{sub}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">{label}</div>
      <div className="text-zinc-200">{children}</div>
    </div>
  );
}

export function duration(sec: number): string {
  return sec < 90 ? `${sec.toFixed(1)} s` : `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
}

export const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X" };
