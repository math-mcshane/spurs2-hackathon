"use client";

import Link from "next/link";
import { ArrowLeftIcon, ShieldAlertIcon } from "lucide-react";
import { DEMO_CLEARANCE_LABEL } from "@/lib/contracts";
import type { PoliciesResponse } from "@/lib/api-client";
import { ErrorState } from "./shared";

/** Advanced rights desk header. The policy is selected per asset + intent, so the banner lists what is bundled. */
export function AppHeader({ policies, policiesError, reviewer }: { policies: PoliciesResponse | null; policiesError: unknown; reviewer?: React.ReactNode }) {
  const fictional = policies?.policies.filter((p) => p.fictional) ?? [];
  return (
    <header className="border-b border-white/8 bg-zinc-950/80 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-lg font-black tracking-[0.3em] text-zinc-50">
            RE<span className="text-red-500">●</span>ROUTE
          </span>
          <span className="hidden text-xs text-zinc-400 sm:inline">Advanced rights desk — segment-level decisions, evidence and receipts.</span>
        </div>
        <div className="flex items-center gap-4">
          {reviewer}
          <Link href="/" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100">
            <ArrowLeftIcon className="size-3.5" aria-hidden /> Back to the campaign studio
          </Link>
        </div>
      </div>
      {fictional.length > 0 && (
        <div
          role="note"
          aria-label="Demo policies"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-amber-500/40 bg-amber-500/15 px-4 py-1.5 text-xs text-amber-200"
        >
          <ShieldAlertIcon className="size-4 text-amber-400" aria-hidden />
          <strong className="font-mono tracking-[0.12em] text-amber-300">{DEMO_CLEARANCE_LABEL}</strong>
          <span className="text-amber-200/80">
            The policy is selected per asset and publish intent. Bundled demo policies: {fictional.map((p) => `${p.id} v${p.version}`).join(", ")}. Their
            rules are invented for demonstration and never authorize publication.
          </span>
        </div>
      )}
      {policiesError !== null && (
        <div className="px-4 pb-2">
          <ErrorState error={policiesError} service="Policy" />
        </div>
      )}
    </header>
  );
}
