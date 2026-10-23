"use client";

import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CLUBS } from "../clubs";
import type { Club } from "../types";

const ORDER: Club[] = ["tottenham", "spurs"];

/** A crest-like monogram from design tokens only (no club artwork): white kit for Tottenham, black and silver for San Antonio. */
const CREST: Record<Club, { letters: string; className: string }> = {
  tottenham: { letters: "TH", className: "bg-ink text-obsidian" },
  spurs: { letters: "SA", className: "bg-obsidian text-ink ring-1 ring-line-strong ring-inset" },
};

export function ClubCrest({ club, className }: { club: Club; className?: string }) {
  const c = CREST[club];
  return (
    <span
      aria-hidden
      className={cn("inline-flex size-6 shrink-0 items-center justify-center rounded-[6px_6px_10px_10px] font-mono text-[0.625rem] font-semibold tracking-tight", c.className, className)}
    >
      {c.letters}
    </span>
  );
}

/**
 * Header control: which club's library and rule packages PULSE works with. Switching asks the caller to change club
 * (which clears the current campaign); it is disabled while an action runs.
 */
export function ClubSwitcher({ club, disabled, onChange }: { club: Club; disabled?: boolean; onChange: (next: Club) => void }) {
  const items = ORDER.map((k) => ({ value: k, label: CLUBS[k].label }));
  return (
    <Select
      items={items}
      value={club}
      disabled={disabled}
      onValueChange={(next) => {
        if ((next === "tottenham" || next === "spurs") && next !== club) onChange(next);
      }}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Club: ${CLUBS[club].label}. Switch club`}
        className="h-8 gap-2 border-line-strong bg-transparent pl-1 text-small text-ink hover:bg-surface dark:bg-transparent"
      >
        <ClubCrest club={club} />
        <span className="hidden max-w-[11rem] truncate sm:inline">{CLUBS[club].label}</span>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="min-w-64 bg-surface-raised text-ink ring-line-strong">
        {ORDER.map((k) => (
          <SelectItem key={k} value={k} className="py-1.5 text-small">
            <ClubCrest club={k} />
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <span className="truncate">{CLUBS[k].label}</span>
              <span className="text-meta text-ink-muted">
                {CLUBS[k].competition} · {CLUBS[k].sport === "football" ? "Football" : "Basketball"}
              </span>
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
