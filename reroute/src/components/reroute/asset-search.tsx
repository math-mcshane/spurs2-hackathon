"use client";

import { useState } from "react";
import { FilmIcon, Loader2Icon, SearchIcon } from "lucide-react";
import type { Asset, ClubCode, DiscoverHit, PartnerFit } from "@/lib/contracts";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, OriginBadge, tc } from "./shared";
import { cn } from "@/lib/utils";

const CLUBS: { value: ClubCode; label: string }[] = [
  { value: "SAS", label: "Spurs (SAS)" },
  { value: "TOT", label: "Tottenham (TOT)" },
];

const FIT_STYLE: Record<PartnerFit, string> = {
  partner_safe: "border-emerald-500/50 text-emerald-300 bg-emerald-950/40",
  needs_review: "border-amber-500/50 text-amber-200 bg-amber-950/40",
  conflict: "border-rose-500/50 text-rose-200 bg-rose-950/40",
};

export function AssetSearch({
  selectedId,
  clubCode,
  onClubChange,
  onSelect,
  onDiscoverMeta,
}: {
  selectedId?: string;
  clubCode: ClubCode;
  onClubChange: (club: ClubCode) => void;
  onSelect: (asset: Asset) => void;
  /** Fired after partner discover so parent can preset partner + weekend intent. */
  onDiscoverMeta?: (meta: { partnerId?: string; weekendPublish: boolean; q: string }) => void;
}) {
  const [q, setQ] = useState("Nike partner photos from last night we can post this weekend");
  const [hits, setHits] = useState<DiscoverHit[] | null>(null);
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [mode, setMode] = useState<"discover" | "scoreplay">("discover");
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      if (mode === "discover") {
        const res = await api.discover(q.trim(), clubCode);
        setHits(res.hits);
        setAssets(null);
        setSource(`${res.source} · ${res.demoDisclaimer.slice(0, 48)}…`);
        onDiscoverMeta?.({
          partnerId: res.intent.partnerSlug === "nike" ? "partner-nike" : undefined,
          weekendPublish: res.intent.weekendPublish,
          q: q.trim(),
        });
      } else {
        const res = await api.searchAssets(q.trim());
        setAssets(res.assets);
        setHits(null);
        setSource("scoreplay");
      }
    } catch (err) {
      setHits(null);
      setAssets(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  const cards: { asset: Asset; fit?: PartnerFit; reasons?: string[] }[] = hits
    ? hits.map((h) => ({ asset: h.asset, fit: h.fit, reasons: h.reasons }))
    : (assets ?? []).map((asset) => ({ asset }));

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-[10px] tracking-widest text-zinc-500 uppercase">Club</Label>
          <div className="flex gap-1">
            {CLUBS.map((c) => (
              <Button
                key={c.value}
                type="button"
                size="sm"
                variant={clubCode === c.value ? "default" : "secondary"}
                className="h-8 font-mono text-[11px]"
                onClick={() => onClubChange(c.value)}
              >
                {c.label}
              </Button>
            ))}
          </div>
        </div>
        <div className="space-y-1">
          <Label className="text-[10px] tracking-widest text-zinc-500 uppercase">Mode</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={mode === "discover" ? "default" : "secondary"}
              className="h-8 text-[11px]"
              onClick={() => setMode("discover")}
            >
              Partner discover
            </Button>
            <Button
              type="button"
              size="sm"
              variant={mode === "scoreplay" ? "default" : "secondary"}
              className="h-8 text-[11px]"
              onClick={() => setMode("scoreplay")}
            >
              ScorePlay
            </Button>
          </div>
        </div>
      </div>

      <form onSubmit={search} className="flex items-end gap-2" role="search">
        <div className="flex-1 space-y-1">
          <Label htmlFor="asset-q" className="text-[10px] tracking-widest text-zinc-500 uppercase">
            {mode === "discover"
              ? "Partner discover (eligible pool + DEMO agreements)"
              : "Search ScorePlay (team, player, match, tag)"}
          </Label>
          <Input
            id="asset-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Nike partner photos from last night post this weekend"
            className="h-8 font-mono text-xs"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={loading} aria-label="Search assets">
          {loading ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
          Search
        </Button>
      </form>

      {source && <p className="text-[10px] text-zinc-500">{source}</p>}
      {error !== null && <ErrorState error={error} service="ScorePlay" />}

      {cards.length === 0 && (hits || assets) && (
        <p className="text-xs text-zinc-500">No assets match “{q}”.</p>
      )}

      {cards.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="Search results">
          {cards.map(({ asset: a, fit, reasons }) => (
            <li key={a.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(a)}
                aria-pressed={a.id === selectedId}
                title={reasons?.join(" · ")}
                className={cn(
                  "group flex w-44 flex-col overflow-hidden rounded-md border bg-zinc-950 text-left transition-colors",
                  a.id === selectedId ? "border-sky-400/70 ring-1 ring-sky-400/40" : "border-white/10 hover:border-white/30",
                )}
              >
                <div className="relative flex aspect-video items-center justify-center bg-zinc-800">
                  {a.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote ScorePlay preview, no optimizer config
                    <img src={a.thumbnailUrl} alt="" className="size-full object-cover" />
                  ) : (
                    <FilmIcon className="size-5 text-zinc-600" aria-hidden />
                  )}
                  {a.durationSec !== undefined && (
                    <span className="absolute right-1 bottom-1 rounded bg-black/70 px-1 font-mono text-[10px] text-zinc-200">
                      {tc(a.durationSec)}
                    </span>
                  )}
                  {fit && (
                    <span
                      className={cn(
                        "absolute top-1 left-1 rounded border px-1 font-mono text-[9px] uppercase",
                        FIT_STYLE[fit],
                      )}
                    >
                      {fit.replace("_", " ")}
                    </span>
                  )}
                </div>
                <div className="space-y-1 p-1.5">
                  <div className="line-clamp-2 text-[11px] leading-tight text-zinc-200">{a.title}</div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-mono text-[9px] text-zinc-500">{a.id}</span>
                    <OriginBadge origin={a.origin} className="h-4 px-1 text-[9px]" />
                  </div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
