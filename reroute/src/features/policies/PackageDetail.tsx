"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckIcon, CircleMinusIcon, CirclePlusIcon, Loader2Icon, RefreshCwIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { ErrorState } from "@/components/reroute/shared";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { CHANNEL_LABEL, Eyebrow, country } from "@/features/pulse/studio/parts";
import { authenticity, clubLabel, policiesApi, type PackageDetail as Detail } from "./api";

const USAGE: Record<string, string> = { EDITORIAL: "Editorial", ORGANIC: "Organic", SPONSORED: "Sponsored", COMMERCIAL: "Commercial (sales)" };
const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const date = (iso: string) => DATE.format(new Date(iso));

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-ink-muted">{label}</dt>
      <dd className="mt-1 text-small text-ink">{children}</dd>
    </div>
  );
}

const listOr = (xs: readonly string[], none: string) => (xs.length ? xs.join(", ") : <span className="text-status-review">{none}</span>);

/** Uses that share the same markets, merged: "Editorial, Organic" → [GB, IE, …]. */
function marketsByUse(byUsage: Record<string, string[]>): { uses: string; markets: string[] }[] {
  const groups = new Map<string, { uses: string[]; markets: string[] }>();
  for (const [usage, markets] of Object.entries(byUsage)) {
    const key = markets.join(",");
    const group = groups.get(key) ?? { uses: [], markets };
    group.uses.push(USAGE[usage] ?? usage);
    groups.set(key, group);
  }
  return [...groups.values()].map((g) => ({ uses: g.uses.join(", "), markets: g.markets }));
}

/** One package: what it licenses, how authentic it is, its warnings and every rule in plain language. */
export function PackageDetail({
  id,
  reviewer,
  uploadsAvailable,
  onSignIn,
  onDefaultChanged,
}: {
  id: string;
  reviewer: { name: string } | null;
  uploadsAvailable: boolean;
  onSignIn: () => void;
  onDefaultChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectError, setSelectError] = useState<unknown>(null);

  const load = useCallback(
    (signal?: AbortSignal) =>
      policiesApi.detail(id, signal).then(
        (d) => {
          setDetail(d);
          setError(null);
        },
        (err: unknown) => {
          if (!signal?.aborted) setError(err);
        },
      ),
    [id],
  );

  useEffect(() => {
    const ac = new AbortController();
    void load(ac.signal);
    return () => ac.abort();
  }, [load]);

  if (error !== null && !detail) {
    return (
      <div className="space-y-3">
        <ErrorState error={error} service="Policy" />
        <Button size="sm" variant="outline" onClick={() => void load()}>
          <RefreshCwIcon /> Retry
        </Button>
      </div>
    );
  }
  if (!detail) {
    return (
      <p role="status" className="flex items-center gap-2 text-small text-ink-muted">
        <Loader2Icon className="size-4 animate-spin" aria-hidden /> Loading the package…
      </p>
    );
  }

  const p = detail.policy;
  const uploaded = p.sourceType !== "PRESET";

  const makeDefault = async () => {
    setSelecting(true);
    setSelectError(null);
    try {
      await policiesApi.select(p.club, p.id);
      await load();
      onDefaultChanged();
    } catch (err) {
      setSelectError(err);
    } finally {
      setSelecting(false);
    }
  };

  return (
    <div className="space-y-10">
      <article className="rounded-xl bg-surface p-5 ring-1 ring-line sm:p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Eyebrow>
              {clubLabel(p.club)} · {p.competitions.join(", ")}
            </Eyebrow>
            <h2 className="mt-2 font-display text-headline font-medium text-ink">{p.title}</h2>
            <p className={cn("mt-2 flex items-start gap-1.5 text-small", p.verified ? "text-status-clear" : "text-status-review")}>
              {p.verified ? <ShieldCheckIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden /> : <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />}
              <span>
                {authenticity(p)}
                {p.verified ? "" : " · not verified legal clearance"}
              </span>
            </p>
            <p className="mt-1 font-mono text-meta text-ink-muted">
              {p.id} · v{p.version}
            </p>
          </div>
          <div className="flex shrink-0 flex-col gap-1.5 sm:items-end">
            {p.isDefault ? (
              <span className="inline-flex items-center gap-1.5 text-small text-ink">
                <CheckIcon className="size-3.5 text-signal" aria-hidden /> Workspace default for {clubLabel(p.club)}
              </span>
            ) : (
              <>
                <Button size="sm" variant="outline" className="bg-transparent" disabled={!reviewer || selecting || !uploadsAvailable} onClick={() => void makeDefault()}>
                  {selecting && <Loader2Icon className="animate-spin" />} Make workspace default
                </Button>
                {!reviewer && (
                  <button type="button" onClick={onSignIn} className="text-meta text-ink-muted underline-offset-4 hover:text-ink hover:underline">
                    Reviewer sign-in required
                  </button>
                )}
                {reviewer && !uploadsAvailable && <span className="text-meta text-ink-muted">Not set up on this deployment</span>}
              </>
            )}
          </div>
        </div>
        {selectError !== null && <ErrorState error={selectError} className="mt-4" />}

        <dl className="mt-6 grid gap-x-8 gap-y-5 border-t border-line pt-6 sm:grid-cols-2">
          <Fact label="Licensed markets">
            {p.territoriesByUsage ? (
              <ul className="space-y-1">
                {marketsByUse(p.territoriesByUsage).map(({ uses, markets }) => (
                  <li key={uses}>
                    <span className="text-ink-muted">{uses}:</span> {markets.length ? markets.map(country).join(", ") : <span className="text-status-review">none</span>}
                  </li>
                ))}
              </ul>
            ) : (
              listOr(p.territories.map(country), "No market licensed")
            )}
          </Fact>
          <Fact label="Channels">{listOr(p.platforms.map((c) => CHANNEL_LABEL[c] ?? c), "No channel licensed")}</Fact>
          <Fact label="Usage categories">{listOr(p.usages.map((u) => USAGE[u] ?? u), "No use licensed")}</Fact>
          <Fact label="Official partners">{p.partners.length ? p.partners.join(", ") : "None named"}</Fact>
          <Fact label="Term">
            {date(p.validFrom)} – {date(p.validUntil)}
          </Fact>
          {p.provenance && <Fact label="Footage covered">{p.provenance}</Fact>}
        </dl>

        {p.warnings.length > 0 && (
          <ul className="mt-6 space-y-2 border-t border-line pt-5" aria-label="Warnings">
            {p.warnings.map((w) => (
              <li key={w} className="flex items-start gap-2 text-small text-ink-soft">
                <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-status-review" aria-hidden />
                {w}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-6 space-y-1 border-t border-line pt-5 text-meta text-ink-muted">
          {uploaded && (
            <p>
              Uploaded{p.uploadedBy ? ` by ${p.uploadedBy}` : ""}
              {p.uploadedAt ? ` on ${date(p.uploadedAt)}` : ""}
              {p.fileName ? ` · ${p.fileName}` : ""}
              {p.sha256 && (
                <>
                  {" "}
                  · sha256 <span className="font-mono">{p.sha256.slice(0, 12)}…</span>
                </>
              )}
            </p>
          )}
          <p className="text-pretty">{p.source}</p>
        </div>
      </article>

      <section aria-labelledby="rules-heading">
        <div className="flex items-baseline justify-between gap-4">
          <h3 id="rules-heading" className="font-display text-headline font-medium text-ink">
            The rules, in plain language
          </h3>
          <span className="text-meta text-ink-muted">{detail.rules.length} rules</span>
        </div>
        <ol className="mt-4 divide-y divide-line border-y border-line">
          {detail.rules.map((r) => {
            const Icon = r.effect === "PERMIT" ? CirclePlusIcon : CircleMinusIcon;
            return (
              <li key={r.id} className="grid gap-x-4 gap-y-1.5 py-4 sm:grid-cols-[9rem_1fr]">
                <div className="flex items-center gap-1.5 text-meta text-ink-muted sm:flex-col sm:items-start sm:gap-1">
                  <span className="inline-flex items-center gap-1.5 font-medium text-ink-soft">
                    <Icon className="size-3.5" aria-hidden />
                    {r.effect === "PERMIT" ? "Allows" : "Restricts"}
                  </span>
                  <span>{r.topics.join(" · ")}</span>
                </div>
                <div className="min-w-0">
                  <p className="text-body text-ink">{r.text}</p>
                  {(r.conditions.length > 0 || r.term) && (
                    <p className="mt-1 text-meta text-ink-muted">{[...r.conditions, ...(r.term ? [`Dates: ${r.term}`] : [])].join(" · ")}</p>
                  )}
                  <p className="mt-1 font-mono text-meta text-ink-muted/70">{r.id}</p>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
