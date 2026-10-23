"use client";

import Link from "next/link";
import { ArrowLeftIcon, TriangleAlertIcon } from "lucide-react";
import type { PoliciesResponse } from "@/lib/api-client";
import { Wordmark } from "@/components/pulse/shell";
import { ErrorState } from "./shared";

/**
 * Header of the advanced rights desk — a PULSE tool for frame-level evidence, not a separate product. The
 * policy is selected per asset + intent, so the note lists every bundled fictional policy.
 */
export function AppHeader({ policies, policiesError, reviewer }: { policies: PoliciesResponse | null; policiesError: unknown; reviewer?: React.ReactNode }) {
  const fictional = policies?.policies.filter((p) => p.fictional) ?? [];
  return (
    <header className="border-b border-line bg-obsidian">
      <div className="flex h-14 flex-wrap items-center justify-between gap-x-6 gap-y-1 px-5">
        <div className="flex items-center gap-4">
          <Link href="/" className="rounded-sm" aria-label="PULSE workspace">
            <Wordmark />
          </Link>
          <span className="h-4 w-px bg-line-strong" aria-hidden />
          <span className="text-small text-ink-soft">Rights desk</span>
          <span className="hidden text-small text-ink-muted md:inline">Frame-level evidence, segment decisions and receipts</span>
        </div>
        <div className="flex items-center gap-4">
          {reviewer}
          <Link href="/" className="inline-flex items-center gap-1.5 text-small text-ink-muted transition-colors hover:text-ink">
            <ArrowLeftIcon className="size-3.5" aria-hidden /> Back to workspace
          </Link>
        </div>
      </div>
      {fictional.length > 0 && (
        <p role="note" aria-label="Demo policies" className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line px-5 py-2 text-meta text-ink-muted">
          <TriangleAlertIcon className="size-3.5 text-status-review" aria-hidden />
          <span className="text-ink-soft">Demo policy — not verified legal clearance.</span>
          <span>
            Policy selected per asset and use. Bundled demo policies: {fictional.map((p) => `${p.id} v${p.version}`).join(", ")} — invented for demonstration, never
            authorize publication.
          </span>
        </p>
      )}
      {policiesError !== null && (
        <div className="px-5 pb-2">
          <ErrorState error={policiesError} service="Policy" />
        </div>
      )}
    </header>
  );
}
