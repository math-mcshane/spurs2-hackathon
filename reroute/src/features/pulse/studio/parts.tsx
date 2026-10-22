"use client";

import { CheckIcon, CircleDashedIcon, OctagonXIcon, ShieldAlertIcon, ShieldCheckIcon, ShieldQuestionIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CampaignStage, RightsPresentation } from "../types";

type Tone = "neutral" | "review" | "blocked" | "cleared" | "demo";

export function rightsTone(r: Pick<RightsPresentation, "state" | "cleared">): Tone {
  if (r.state === "ALLOWED") return r.cleared ? "cleared" : "demo";
  return r.state === "BLOCKED" ? "blocked" : r.state === "NEEDS_REVIEW" ? "review" : "neutral";
}

export const TONE: Record<Tone, { pill: string; panel: string; text: string; label: string; Icon: typeof ShieldCheckIcon }> = {
  neutral: { pill: "border-zinc-600 bg-zinc-800/60 text-zinc-300", panel: "border-white/10 bg-zinc-900/60", text: "text-zinc-200", label: "Rights not checked", Icon: ShieldQuestionIcon },
  review: { pill: "border-amber-500/50 bg-amber-500/15 text-amber-200", panel: "border-amber-500/40 bg-amber-500/[0.07]", text: "text-amber-200", label: "Needs rights review", Icon: ShieldAlertIcon },
  blocked: { pill: "border-red-500/60 bg-red-500/15 text-red-200", panel: "border-red-500/40 bg-red-500/[0.07]", text: "text-red-200", label: "Blocked", Icon: OctagonXIcon },
  cleared: { pill: "border-emerald-500/50 bg-emerald-500/15 text-emerald-200", panel: "border-emerald-500/40 bg-emerald-500/[0.07]", text: "text-emerald-200", label: "Rights cleared", Icon: ShieldCheckIcon },
  demo: { pill: "border-violet-500/50 bg-violet-500/15 text-violet-200", panel: "border-violet-500/40 bg-violet-500/[0.07]", text: "text-violet-200", label: "Allowed by demo policy · not cleared", Icon: ShieldQuestionIcon },
};

/** REROUTE's state for one moment. Says "cleared" only when the presentation says cleared. */
export function RightsPill({ rights, className }: { rights: Pick<RightsPresentation, "state" | "cleared">; className?: string }) {
  const t = TONE[rightsTone(rights)];
  return (
    <span
      title="Rights state as decided by REROUTE"
      className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap", t.pill, className)}
    >
      <t.Icon className="size-3" aria-hidden /> {t.label}
    </span>
  );
}

const STAGES: { key: CampaignStage; label: string }[] = [
  { key: "PROPOSED", label: "Proposed" },
  { key: "RIGHTS_CLEARED", label: "Rights cleared" },
  { key: "READY_FOR_APPROVAL", label: "Ready for approval" },
  { key: "APPROVED", label: "Approved" },
];

export function StageTracker({ stage }: { stage: CampaignStage }) {
  const at = STAGES.findIndex((s) => s.key === stage);
  return (
    <ol className="flex flex-wrap items-center gap-1.5 text-[11px]" aria-label="Campaign status">
      {STAGES.map((s, i) => (
        <li key={s.key} className="flex items-center gap-1.5">
          {i > 0 && <span className={cn("h-px w-4", i <= at ? "bg-sky-400" : "bg-white/15")} aria-hidden />}
          <span
            aria-current={i === at ? "step" : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5",
              i < at && "border-sky-500/40 text-sky-300",
              i === at && "border-sky-400 bg-sky-500/15 font-semibold text-sky-100",
              i > at && "border-white/10 text-zinc-500",
            )}
          >
            {i < at ? <CheckIcon className="size-3" aria-hidden /> : i === at ? null : <CircleDashedIcon className="size-3" aria-hidden />}
            {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export function StepHeading({ n, title, sub, active }: { n: number; title: string; sub?: React.ReactNode; active: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span
        className={cn(
          "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border font-mono text-sm",
          active ? "border-sky-400 bg-sky-500/15 text-sky-100" : "border-white/15 text-zinc-500",
        )}
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
