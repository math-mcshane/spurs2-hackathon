"use client";

import Image from "next/image";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CLUBS } from "../clubs";
import type { Club } from "../types";

const ORDER: Club[] = ["tottenham", "spurs"];

/**
 * The clubs' own marks, unmodified (`public/clubs/`, sources in docs/design/DESIGN_SYSTEM.md): the Tottenham Hotspur
 * cockerel from tottenhamhotspur.com in club navy on white, the San Antonio Spurs spur from the NBA's team CDN on black.
 * Each sits on a fixed tile so it reads on every club theme. They name the selected workspace, nothing more.
 */
const LOGO: Record<Club, { src: string; width: number; height: number; tile: string; logo: string }> = {
  tottenham: { src: "/clubs/tottenham-hotspur.svg", width: 1216, height: 3040, tile: "bg-white", logo: "h-[78%]" },
  spurs: { src: "/clubs/san-antonio-spurs.png", width: 261, height: 320, tile: "bg-black ring-1 ring-[#c4ced4]/45 ring-inset", logo: "h-[74%]" },
};

export function ClubLogo({ club, className }: { club: Club; className?: string }) {
  const l = LOGO[club];
  return (
    <span aria-hidden className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-md", l.tile, className)}>
      <Image src={l.src} alt="" width={l.width} height={l.height} unoptimized draggable={false} className={cn("w-auto object-contain", l.logo)} />
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
        className="h-10 gap-2.5 border-line-strong bg-transparent py-1 pl-1 text-small font-medium text-ink hover:bg-surface data-[size=sm]:h-10 dark:bg-transparent"
      >
        <ClubLogo club={club} />
        <span className="hidden max-w-[11rem] truncate sm:inline">{CLUBS[club].label}</span>
      </SelectTrigger>
      <SelectContent align="end" alignItemWithTrigger={false} className="min-w-64 bg-surface-raised text-ink ring-line-strong">
        {ORDER.map((k) => (
          <SelectItem key={k} value={k} className="py-1.5 text-small">
            <ClubLogo club={k} />
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
