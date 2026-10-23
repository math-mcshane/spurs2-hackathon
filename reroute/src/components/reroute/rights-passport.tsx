"use client";

import { useEffect, useState } from "react";
import { api, describeError, isAbort } from "@/lib/api-client";
import type { PassportResponse } from "@/lib/contracts";

const USES = [
  "instagram",
  "tiktok",
  "youtube",
  "x",
  "club_app",
  "venue_screen",
  "sponsor_use",
] as const;
const REGIONS = ["US", "UK", "ROW"] as const;

const USE_LABEL: Record<(typeof USES)[number], string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  x: "X",
  club_app: "Club app",
  venue_screen: "Venue screen",
  sponsor_use: "Sponsor use",
};

function cellLabel(v: string | undefined): string {
  switch (v) {
    case "allow":
      return "Allow";
    case "allow_limited":
      return "Allow · limits";
    case "review":
      return "Review";
    case "block":
      return "Block";
    default:
      return "—";
  }
}

function cellClass(v: string | undefined): string {
  switch (v) {
    case "allow":
      return "text-emerald-200";
    case "allow_limited":
      return "text-emerald-200/90";
    case "review":
      return "text-amber-200";
    case "block":
      return "text-rose-200";
    default:
      return "text-zinc-500";
  }
}

/** 7×3 Rights Passport grid (text labels — not color alone). */
export function RightsPassport({ mediaId }: { mediaId: string | null }) {
  const [state, setState] = useState<
    { status: "idle" } | { status: "loading" } | { status: "done"; data: PassportResponse } | { status: "error"; error: unknown }
  >({ status: "idle" });

  useEffect(() => {
    if (!mediaId) {
      setState({ status: "idle" });
      return;
    }
    const ac = new AbortController();
    setState({ status: "loading" });
    void api
      .passport(mediaId, { signal: ac.signal })
      .then((data) => setState({ status: "done", data }))
      .catch((err) => {
        if (!isAbort(err)) setState({ status: "error", error: err });
      });
    return () => ac.abort();
  }, [mediaId]);

  if (!mediaId) {
    return <p className="text-xs text-zinc-500">Select an asset to load its Rights Passport.</p>;
  }
  if (state.status === "loading") {
    return <p className="text-xs text-zinc-400">Loading passport…</p>;
  }
  if (state.status === "error") {
    const d = describeError(state.error);
    return (
      <p className="text-xs text-rose-300">
        {d.title}: {d.detail}
      </p>
    );
  }
  if (state.status !== "done") return null;

  const { data } = state;
  const missing = data.source === "missing" || Object.keys(data.cells).length === 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-baseline gap-2 text-[11px] text-zinc-400">
        <span className="font-medium text-zinc-200">Rights Passport</span>
        <span>· {data.verdict.replace("_", " ")}</span>
        {data.usableUntil && <span>· usable until {data.usableUntil}</span>}
        {data.policyPackId && (
          <span className="truncate opacity-70">
            · {data.policyPackId}@{data.policyVersion}
          </span>
        )}
      </div>
      {missing ? (
        <p className="text-xs text-zinc-500">
          No passport synced yet. Run the Databricks pipeline (L2) or POST /api/l2/enqueue for this media.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[28rem] border-collapse text-[11px]">
            <caption className="sr-only">Platform by region clearance grid</caption>
            <thead>
              <tr className="text-left text-zinc-500">
                <th scope="col" className="py-1 pr-2 font-normal">
                  Use
                </th>
                {REGIONS.map((r) => (
                  <th key={r} scope="col" className="px-1 py-1 font-normal">
                    {r === "ROW" ? "Rest of world" : r}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {USES.map((use) => (
                <tr key={use} className="border-t border-white/5">
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal text-zinc-300">
                    {USE_LABEL[use]}
                  </th>
                  {REGIONS.map((region) => {
                    const cell = data.cells[use]?.[region];
                    const v = cell?.verdict;
                    return (
                      <td key={region} className={`px-1 py-1.5 ${cellClass(v)}`}>
                        <span className="font-medium">{cellLabel(v)}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.rulesFired.length > 0 && (
        <p className="text-[10px] text-zinc-500">Rules fired: {data.rulesFired.join(", ")}</p>
      )}
      <p className="text-[10px] leading-snug text-zinc-500">{data.demoDisclaimer}</p>
    </div>
  );
}
