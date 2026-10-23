"use client";

import { UsageSchema, type Usage } from "@/lib/contracts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/** Draft intent as edited in the form; becomes a `PublishIntent` once every field is valid. */
export type IntentDraft = {
  /** Publishing club (drives policy selection); "" = not stated. */
  club: string;
  territory: string;
  platform: string;
  usage: Usage;
  competition: string;
  /** ISO timestamp, or "" until set. */
  publishAt: string;
};

const CLUB_OPTIONS = [
  { value: "tottenham", label: "Tottenham Hotspur" },
  { value: "spurs", label: "San Antonio Spurs" },
  { value: "", label: "Not stated" },
];

const TERRITORIES = [
  { value: "GB", label: "GB · United Kingdom" },
  { value: "FR", label: "FR · France" },
  { value: "US", label: "US · United States" },
  { value: "DE", label: "DE · Germany" },
  { value: "ES", label: "ES · Spain" },
  { value: "IT", label: "IT · Italy" },
  { value: "CA", label: "CA · Canada" },
  { value: "MX", label: "MX · Mexico" },
];
const PLATFORMS = [
  { value: "instagram", label: "Instagram" },
  { value: "facebook", label: "Facebook" },
  { value: "youtube", label: "YouTube" },
  { value: "tiktok", label: "TikTok" },
  { value: "x", label: "X" },
];

function toLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const off = d.getTimezoneOffset() * 60_000;
  return new Date(d.getTime() - off).toISOString().slice(0, 16);
}

export function IntentForm({
  value,
  onChange,
  competitionFromAsset,
}: {
  value: IntentDraft;
  onChange: (patch: Partial<IntentDraft>) => void;
  competitionFromAsset?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-2 lg:grid-cols-[1fr_1fr_auto]">
      <div className="col-span-2 space-y-1 lg:col-span-3">
        <Label htmlFor="intent-club" className="text-[10px] tracking-widest text-zinc-500 uppercase">Publishing club</Label>
        <Select items={CLUB_OPTIONS} value={value.club} onValueChange={(v) => onChange({ club: v ?? "" })}>
          <SelectTrigger id="intent-club" size="sm" className="w-full text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {CLUB_OPTIONS.map((c) => (
              <SelectItem key={c.value} value={c.value} className="text-xs">
                {c.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="intent-territory" className="text-[10px] tracking-widest text-zinc-500 uppercase">Territory</Label>
        <Select items={TERRITORIES} value={value.territory} onValueChange={(v) => v && onChange({ territory: v })}>
          <SelectTrigger id="intent-territory" size="sm" className="w-full font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {TERRITORIES.map((t) => (
              <SelectItem key={t.value} value={t.value} className="font-mono text-xs">
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="intent-platform" className="text-[10px] tracking-widest text-zinc-500 uppercase">Platform</Label>
        <Select items={PLATFORMS} value={value.platform} onValueChange={(v) => v && onChange({ platform: v })}>
          <SelectTrigger id="intent-platform" size="sm" className="w-full font-mono text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLATFORMS.map((p) => (
              <SelectItem key={p.value} value={p.value} className="font-mono text-xs">
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 space-y-1 lg:col-span-1">
        <span id="intent-usage-label" className="text-[10px] font-medium tracking-widest text-zinc-500 uppercase">
          Usage
        </span>
        <div role="radiogroup" aria-labelledby="intent-usage-label" className="flex h-7 flex-wrap rounded-md border border-white/10 p-0.5">
          {UsageSchema.options.map((u) => (
            <button
              key={u}
              type="button"
              role="radio"
              aria-checked={value.usage === u}
              onClick={() => onChange({ usage: u })}
              className={cn(
                "rounded px-2 font-mono text-[10px] tracking-wider transition-colors",
                value.usage === u
                  ? u === "SPONSORED" || u === "COMMERCIAL"
                    ? "bg-fuchsia-500/25 text-fuchsia-200"
                    : "bg-sky-500/25 text-sky-200"
                  : "text-zinc-500 hover:text-zinc-300",
              )}
            >
              {u}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <Label htmlFor="intent-competition" className="text-[10px] tracking-widest text-zinc-500 uppercase">
          Competition
        </Label>
        <Input
          id="intent-competition"
          value={value.competition}
          onChange={(e) => onChange({ competition: e.target.value })}
          placeholder={competitionFromAsset ? competitionFromAsset : "not in asset metadata"}
          aria-describedby="intent-competition-hint"
          className="h-7 font-mono text-xs"
        />
        <p id="intent-competition-hint" className="text-[9px] text-zinc-500">
          {competitionFromAsset ? `ScorePlay fact: ${competitionFromAsset}` : "No ScorePlay competition fact — enter it"}
        </p>
      </div>
      <div className="space-y-1 lg:col-span-2">
        <Label htmlFor="intent-publish-at" className="text-[10px] tracking-widest text-zinc-500 uppercase">
          Publish at (local)
        </Label>
        <Input
          id="intent-publish-at"
          type="datetime-local"
          value={toLocalInput(value.publishAt)}
          onChange={(e) => {
            const d = new Date(e.target.value);
            onChange({ publishAt: Number.isNaN(d.getTime()) ? "" : d.toISOString() });
          }}
          className="h-7 font-mono text-xs [color-scheme:dark]"
        />
      </div>
    </div>
  );
}
