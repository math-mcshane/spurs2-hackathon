"use client";

import { ShieldAlertIcon } from "lucide-react";
import type { PoliciesResponse } from "@/lib/api-client";
import { ErrorState } from "./shared";

export function AppHeader({ policies, policiesError }: { policies: PoliciesResponse | null; policiesError: unknown }) {
  const active = policies?.policies.find((p) => p.id === policies.activeId);
  return (
    <header className="border-b border-white/8 bg-zinc-950/80 backdrop-blur">
      <div className="flex items-center justify-between gap-4 px-4 py-2.5">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-lg font-black tracking-[0.3em] text-zinc-50">
            RE<span className="text-red-500">●</span>ROUTE
          </span>
          <span className="hidden text-xs text-zinc-400 sm:inline">
            Turns a rights restriction into a clear decision and a creative path forward.
          </span>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-zinc-500">
          <span className="inline-block size-1.5 rounded-full bg-red-500 shadow-[0_0_6px] shadow-red-500" aria-hidden />
          RIGHTS DESK
          {active && (
            <span className="text-zinc-400">
              · policy <span className="text-zinc-200">{active.id}</span> v{active.version}
            </span>
          )}
        </div>
      </div>
      {active?.fictional && (
        <div
          role="note"
          aria-label="Fictional demo policy"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-amber-500/40 bg-amber-500/15 px-4 py-1.5 text-xs text-amber-200"
        >
          <ShieldAlertIcon className="size-4 text-amber-400" aria-hidden />
          <strong className="font-mono tracking-[0.2em] text-amber-300">FICTIONAL DEMO POLICY</strong>
          <span>
            {active.title ?? active.id} · version {active.version}
            {active.source ? ` · source: ${active.source}` : ""}
          </span>
          <span className="text-amber-200/80">
            {active.disclaimer ??
              "Rules are invented for demonstration. They are not real Spurs, Tottenham, NBA or Premier League rights."}
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
