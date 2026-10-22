"use client";

import { useState } from "react";
import { FilmIcon, Loader2Icon, SearchIcon } from "lucide-react";
import type { Asset } from "@/lib/contracts";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, OriginBadge, tc } from "./shared";
import { cn } from "@/lib/utils";

export function AssetSearch({ selectedId, onSelect }: { selectedId?: string; onSelect: (asset: Asset) => void }) {
  const [q, setQ] = useState("Spurs");
  const [assets, setAssets] = useState<Asset[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

  async function search(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await api.searchAssets(q.trim());
      setAssets(res.assets);
    } catch (err) {
      setAssets(null);
      setError(err);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={search} className="flex items-end gap-2" role="search">
        <div className="flex-1 space-y-1">
          <Label htmlFor="asset-q" className="text-[10px] tracking-widest text-zinc-500 uppercase">
            Search ScorePlay (team, player, match, tag)
          </Label>
          <Input
            id="asset-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="e.g. Spurs playoff dunk"
            className="h-8 font-mono text-xs"
          />
        </div>
        <Button type="submit" size="sm" variant="secondary" disabled={loading} aria-label="Search ScorePlay assets">
          {loading ? <Loader2Icon className="animate-spin" /> : <SearchIcon />}
          Search
        </Button>
      </form>

      {error !== null && <ErrorState error={error} service="ScorePlay" />}

      {assets && assets.length === 0 && (
        <p className="text-xs text-zinc-500">No ScorePlay assets match “{q}”.</p>
      )}

      {assets && assets.length > 0 && (
        <ul className="flex gap-2 overflow-x-auto pb-1" aria-label="ScorePlay search results">
          {assets.map((a) => (
            <li key={a.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onSelect(a)}
                aria-pressed={a.id === selectedId}
                className={cn(
                  "group flex w-40 flex-col overflow-hidden rounded-md border bg-zinc-950 text-left transition-colors",
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
