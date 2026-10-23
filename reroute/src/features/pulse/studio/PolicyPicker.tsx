"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { policiesApi, type PackageSummary } from "@/features/policies/api";
import { cn } from "@/lib/utils";

const tagOf = (p: PackageSummary) => (p.sourceType !== "PRESET" ? "Uploaded — unverified" : p.verified ? "Verified" : "Demo policy");

/**
 * Compact switch between the club's rule packages (Policy Center library). `value` = the package the run uses;
 * without one, the workspace default is shown. `triggerLabel` replaces the selected title on the trigger (when the
 * title is already shown beside it). Changing it asks the caller to re-evaluate under that package.
 */
export function PolicyPicker({
  club,
  value,
  disabled,
  triggerLabel,
  onChange,
}: {
  club: string;
  value?: string;
  disabled?: boolean;
  triggerLabel?: string;
  onChange(packageId: string): void;
}) {
  const [packages, setPackages] = useState<PackageSummary[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const ac = new AbortController();
    policiesApi.library(club, ac.signal).then(
      (lib) => {
        setPackages(lib.policies);
        setFailed(false);
      },
      () => {
        if (!ac.signal.aborted) setFailed(true);
      },
    );
    return () => ac.abort();
  }, [club]);

  const current = value ?? packages?.find((p) => p.isDefault)?.id;
  const items = (packages ?? []).map((p) => ({ value: p.id, label: p.title }));

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {packages && packages.length > 1 ? (
        <Select
          items={items}
          value={current ?? null}
          disabled={disabled}
          onValueChange={(next) => {
            if (typeof next === "string" && next !== current) onChange(next);
          }}
        >
          <SelectTrigger size="sm" aria-label="Rule package" className="max-w-[16rem] border-line-strong text-meta text-ink-soft">
            {triggerLabel ? <span>{triggerLabel}</span> : <SelectValue />}
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false} className="min-w-72 bg-surface-raised text-ink ring-line-strong">
            {packages.map((p) => (
              <SelectItem key={p.id} value={p.id} className="py-1.5 text-small">
                <span className="flex min-w-0 flex-col items-start gap-0.5">
                  <span className="truncate">{p.title}</span>
                  <span className={cn("text-meta", p.sourceType !== "PRESET" ? "text-status-review" : "text-ink-muted")}>
                    {tagOf(p)}
                    {p.isDefault ? " · workspace default" : ""}
                  </span>
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        failed && <span className="text-meta text-ink-muted">Rule packages unavailable</span>
      )}
      <Link
        href={current ? `/policies?${new URLSearchParams({ package: current })}` : "/policies"}
        className="text-meta text-ink-muted underline-offset-4 hover:text-ink hover:underline"
      >
        Policy Center
      </Link>
    </div>
  );
}
