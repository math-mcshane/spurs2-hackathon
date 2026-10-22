"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, FilmIcon, Loader2Icon, RefreshCwIcon, SearchXIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, Panel, PanelTitle } from "@/components/reroute/shared";
import { CLUBS } from "./clubs";
import { pulseApi } from "./client";
import {
  COMMERCIAL,
  CommercialBadge,
  DELIVERABLE_LABEL,
  DemoBanner,
  FictionalBriefTag,
  RIGHTS_MESSAGE,
  RIGHTS_TEXT_CLASS,
  evidenceLabel,
  PulseHeader,
  RightsBadge,
  STATUS_LABEL,
  ScoreDetails,
  SourceBadge,
  minutes,
  when,
} from "./pulse-ui";
import { MarketBlock, MarketScoreDetails, ObjectivePanel, RankingComparison } from "./MarketOpportunity";
import type { BusinessMetrics, Club, OpportunitiesResponse, OpportunityView, SponsorBrief } from "./types";

export function PulseDashboard() {
  const [data, setData] = useState<OpportunitiesResponse | null>(null);
  const [business, setBusiness] = useState<BusinessMetrics | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showAll, setShowAll] = useState(false);

  async function loadBusiness() {
    try {
      setBusiness(await pulseApi.business());
    } catch (err) {
      setError(err);
    }
  }

  useEffect(() => {
    let live = true;
    pulseApi.list().then(
      (d) => {
        if (!live) return;
        setData(d);
        // Business metrics are derived from the same snapshot: fetch after it exists.
        void pulseApi.business().then((b) => live && setBusiness(b), (err) => live && setError(err));
      },
      (err) => live && setError(err),
    );
    return () => {
      live = false;
    };
  }, []);

  async function refresh(body: Parameters<typeof pulseApi.refresh>[0] = {}, success = "Signals re-read and media re-searched") {
    setRefreshing(true);
    try {
      setData(await pulseApi.refresh(body));
      setError(null);
      await loadBusiness();
      toast.success(success);
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setRefreshing(false);
    }
  }

  const active = data?.opportunities.filter((o) => o.status !== "DISMISSED") ?? [];
  const dismissed = data?.opportunities.filter((o) => o.status === "DISMISSED") ?? [];
  // With an objective, lead with the three best recommendations; the rest stay one click away.
  const shown = data?.objective && !showAll ? active.slice(0, 3) : active;

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.07),transparent_60%)]">
      <PulseHeader
        right={
          <Button size="sm" variant="outline" disabled={refreshing} onClick={() => void refresh()}>
            {refreshing ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />}
            Refresh signals
          </Button>
        }
      />
      {data && <DemoBanner meta={data.meta} />}

      <main className="flex flex-1 flex-col gap-3 p-3">
        {error !== null && <ErrorState error={error} />}
        {!data && error === null && (
          <div className="flex items-center gap-2 p-6 text-sm text-zinc-400">
            <Loader2Icon className="size-4 animate-spin" /> Reading signals and searching ScorePlay…
          </div>
        )}

        {data && (
          <>
            <ObjectivePanel
              objective={data.objective}
              busy={refreshing}
              onSet={(objective) => refresh({ objective }, "Objective set — opportunities re-ranked for this objective")}
              onClear={() => void refresh({ objective: null }, "Objective cleared")}
            />

            <RankingComparison
              comparison={data.comparison}
              onUse={(objective) => void refresh({ objective }, `Objective set: ${objective}`)}
            />

            <KpiRow opportunities={active} business={business} />

            <Panel aria-labelledby="p-board">
              <PanelTitle
                step="A"
                right={
                  <span className="font-mono text-[10px] text-zinc-500">
                    built {when(data.meta.builtAt)} · source {data.meta.signalSource}
                  </span>
                }
              >
                <span id="p-board">
                  {data.objective
                    ? `Top recommendations for “${data.objective.summary}” · rights-ready first`
                    : "Opportunity board · rights-ready first"}
                </span>
              </PanelTitle>
              <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
                {shown.map((o) => (
                  <OpportunityCard key={o.id} o={o} brief={data.briefs.find((b) => b.id === o.sponsorBriefId)} />
                ))}
                {active.length === 0 && <p className="text-xs text-zinc-500">No active opportunities. Add a producer trigger below.</p>}
              </div>
              {active.length > shown.length && (
                <div className="px-3 pb-3">
                  <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
                    Show {active.length - shown.length} more
                  </Button>
                </div>
              )}
              {dismissed.length > 0 && (
                <div className="border-t border-white/5 px-3 py-2 text-[11px] text-zinc-500">
                  Dismissed:{" "}
                  {dismissed.map((o, i) => (
                    <span key={o.id}>
                      {i > 0 && " · "}
                      <Link href={`/pulse/opportunity/${o.id}`} className="underline-offset-2 hover:underline">
                        {o.headline}
                      </Link>
                      {o.ledger.dismissReason && ` (${o.ledger.dismissReason})`}
                    </span>
                  ))}
                </div>
              )}
            </Panel>

            <ManualTrigger
              briefs={data.briefs}
              busy={refreshing}
              onSubmit={(manual) => refresh({ manual }, "Producer trigger added and opportunities rebuilt")}
            />

            <Outcomes business={business} />
          </>
        )}
      </main>
      <footer className="px-4 pb-3 font-mono text-[9px] text-zinc-600">
        PULSE recommends; it does not publish, certify rights or book revenue. Rights states come only from REROUTE. Public
        posts are never a representative sample of all fans.
      </footer>
    </div>
  );
}

function Kpi({ label, value, sub }: { label: string; value: React.ReactNode; sub: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/8 bg-zinc-900/60 px-3 py-2.5">
      <div className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500 uppercase">{label}</div>
      <div className="mt-1 font-mono text-2xl font-semibold text-zinc-50">{value}</div>
      <div className="mt-0.5 text-[11px] text-zinc-500">{sub}</div>
    </div>
  );
}

function KpiRow({ opportunities, business }: { opportunities: OpportunityView[]; business: BusinessMetrics | null }) {
  const due = business?.fulfillment.reduce((n, f) => n + f.remaining, 0);
  const contracted = business?.fulfillment.reduce((n, f) => n + f.contracted, 0);
  const demo = business?.fulfillment.some((f) => f.dataStatus === "DEMO");
  const ready = opportunities.filter((o) => o.gate === "RIGHTS_READY").length;
  const inventory = opportunities.filter((o) => o.commercialState !== "EDITORIAL" && o.media?.status === "FOUND").length;
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label="Sponsor deliverables due"
        value={due ?? "…"}
        sub={
          business && (
            <>
              open of {contracted} contracted{demo && <span className="text-amber-300"> · fictional brief</span>}
            </>
          )
        }
      />
      <Kpi
        label="Rights-ready opportunities"
        value={ready}
        sub={business ? `confirmed by REROUTE · ${business.rightsYield.evaluated} evaluated so far` : "confirmed by REROUTE"}
      />
      <Kpi label="Qualified content inventory" value={inventory} sub="partner-matched ideas with footage — candidates, not sold revenue" />
      <Kpi
        label="Production time saved"
        value={business?.efficiency.medianTimeToReadyMinutes !== undefined ? minutes(business.efficiency.medianTimeToReadyMinutes) : "Not measured"}
        sub={
          business?.efficiency.medianTimeToReadyMinutes !== undefined
            ? "observed median detection → approval; no baseline, so no savings claimed"
            : "no manual baseline recorded"
        }
      />
    </div>
  );
}

function OpportunityCard({ o, brief }: { o: OpportunityView; brief?: SponsorBrief }) {
  const sample = o.signal.samples[0];
  const media = o.media;
  const top = media?.candidates[0];
  return (
    <article className="flex flex-col gap-2.5 rounded-lg border border-white/8 bg-zinc-950/60 p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <RightsBadge state={o.rightsState} />
        <CommercialBadge state={o.commercialState} />
        <SourceBadge mode={o.evidenceMode} />
      </div>
      <div>
        <h3 className="text-base font-semibold text-zinc-50">{o.headline}</h3>
        <p className="text-[11px] text-zinc-500">
          {CLUBS[o.club].label} · {o.game} · {o.focus}
        </p>
      </div>
      {o.market ? (
        <MarketBlock fit={o.market} />
      ) : (
        <p className="text-xs text-zinc-300">
          {o.interestSummary}
          {sample && <span className="mt-1 block text-zinc-500 italic">“{sample.text}”</span>}
        </p>
      )}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-zinc-500">Signal</dt>
        <dd className="text-zinc-300">
          {o.evidenceMode === "MANUAL" ? "producer note" : `${o.signal.sampleCount} sampled post(s)`} · confidence {o.signal.confidence} ·{" "}
          {when(o.signal.observedAt)}
        </dd>
        <dt className="text-zinc-500">Audience</dt>
        <dd className="text-zinc-300">{o.targetAudienceCohort}</dd>
        <dt className="text-zinc-500">Brief</dt>
        <dd className="text-zinc-300">
          {brief ? (
            <>
              {brief.partnerLabel} {brief.dataStatus === "DEMO" && <FictionalBriefTag className="ml-1 h-4 px-1 text-[9px]" />}
            </>
          ) : (
            "none — editorial"
          )}
        </dd>
        <dt className="text-zinc-500">Footage</dt>
        <dd className="min-w-0 text-zinc-300">
          {top ? (
            <span className="flex items-center gap-1">
              <FilmIcon className="size-3 shrink-0" aria-hidden />
              <span className="truncate">{top.title}</span>
            </span>
          ) : (
            <span className="flex items-center gap-1 text-amber-300">
              <SearchXIcon className="size-3 shrink-0" aria-hidden />
              No ScorePlay video
            </span>
          )}
          {media && (
            <span className={top?.foundBy === "TWELVELABS" ? "block text-sky-300" : "block text-zinc-500"}>
              {top ? evidenceLabel(top) : media.intelligence.message}
            </span>
          )}
        </dd>
        <dt className="text-zinc-500">Rights</dt>
        <dd className={RIGHTS_TEXT_CLASS[o.rightsState]}>
          {RIGHTS_MESSAGE[o.rightsState]} · {STATUS_LABEL[o.status]}
          {DELIVERABLE_LABEL[o.deliverableState] && <span className="text-zinc-400"> · {DELIVERABLE_LABEL[o.deliverableState]}</span>}
        </dd>
      </dl>
      <div className="mt-auto flex items-end justify-between gap-2 border-t border-white/5 pt-2">
        {o.market ? <MarketScoreDetails fit={o.market} /> : <ScoreDetails score={o.score} />}
        <Button size="sm" render={<Link href={`/pulse/opportunity/${o.id}`} />} nativeButton={false}>
          Review opportunity <ArrowRightIcon />
        </Button>
      </div>
    </article>
  );
}

function ManualTrigger({
  briefs,
  busy,
  onSubmit,
}: {
  briefs: SponsorBrief[];
  busy: boolean;
  onSubmit: (m: { club: Club; text: string; mediaQuery?: string; sponsorBriefId?: string }) => Promise<boolean>;
}) {
  const [club, setClub] = useState<Club>("spurs");
  const [text, setText] = useState("");
  const [mediaQuery, setMediaQuery] = useState("");
  const [briefId, setBriefId] = useState("");
  const clubBriefs = briefs.filter((b) => b.club === club);
  return (
    <Panel aria-labelledby="p-manual">
      <PanelTitle step="+">
        <span id="p-manual">Producer trigger · manual signal</span>
      </PanelTitle>
      <form
        className="grid gap-3 p-3 md:grid-cols-[auto_2fr_1fr_1fr_auto] md:items-end"
        onSubmit={async (e) => {
          e.preventDefault();
          const ok = await onSubmit({
            club,
            text,
            mediaQuery: mediaQuery.trim() || undefined,
            sponsorBriefId: briefId || undefined,
          });
          if (ok) {
            setText("");
            setMediaQuery("");
          }
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="m-club" className="text-[10px] tracking-widest text-zinc-500 uppercase">Club</Label>
          <select
            id="m-club"
            value={club}
            onChange={(e) => {
              setClub(e.target.value as Club);
              setBriefId("");
            }}
            className="h-8 rounded-lg border border-input bg-input/30 px-2 text-xs"
          >
            {Object.entries(CLUBS).map(([k, c]) => (
              <option key={k} value={k}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="m-text" className="text-[10px] tracking-widest text-zinc-500 uppercase">What are fans reacting to?</Label>
          <Input id="m-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="fans are reacting to the bench celebrating" minLength={3} maxLength={280} required />
        </div>
        <div className="space-y-1">
          <Label htmlFor="m-q" className="text-[10px] tracking-widest text-zinc-500 uppercase">Player, team or filename (optional)</Label>
          <Input id="m-q" value={mediaQuery} onChange={(e) => setMediaQuery(e.target.value)} placeholder="e.g. Wembanyama" maxLength={120} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="m-brief" className="text-[10px] tracking-widest text-zinc-500 uppercase">Sponsor brief (optional)</Label>
          <select
            id="m-brief"
            value={briefId}
            onChange={(e) => setBriefId(e.target.value)}
            className="h-8 w-full rounded-lg border border-input bg-input/30 px-2 text-xs"
          >
            <option value="">None — editorial</option>
            {clubBriefs.map((b) => (
              <option key={b.id} value={b.id}>
                {b.partnerLabel}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" size="sm" disabled={busy || text.trim().length < 3}>
          Add trigger
        </Button>
      </form>
    </Panel>
  );
}

function Outcomes({ business }: { business: BusinessMetrics | null }) {
  if (!business) {
    return (
      <Panel>
        <PanelTitle step="C">Business outcomes</PanelTitle>
        <div className="p-3 text-xs text-zinc-500">Loading…</div>
      </Panel>
    );
  }
  const max = Math.max(1, ...business.funnel.map((s) => s.count));
  return (
    <Panel aria-labelledby="p-outcomes">
      <PanelTitle step="C">
        <span id="p-outcomes">Business outcomes · ledger</span>
      </PanelTitle>
      <div className="grid gap-4 p-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          <h3 className="text-[10px] font-semibold tracking-[0.18em] text-zinc-500 uppercase">Funnel</h3>
          {business.funnel.map((s) => (
            <div key={s.key} className="grid grid-cols-[13rem_1fr_auto] items-center gap-2 text-xs">
              <span className="truncate text-zinc-300" title={s.label}>{s.label}</span>
              <div className="h-2 rounded-sm bg-white/5">
                <div className="h-2 rounded-sm bg-sky-500/70" style={{ width: `${(100 * s.count) / max}%` }} />
              </div>
              <span className="w-28 text-right font-mono text-zinc-200">
                {s.count}
                {s.medianMinutesFromDetection !== undefined && (
                  <span className="text-zinc-500"> · {minutes(s.medianMinutesFromDetection)}</span>
                )}
              </span>
            </div>
          ))}
          <ul className="mt-3 list-disc space-y-0.5 pl-4 text-[11px] text-zinc-500">
            {business.dataQuality.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </div>

        <div className="grid gap-3">
          <section className="rounded-md border border-sky-500/30 bg-sky-500/5 p-2.5">
            <h3 className="text-[10px] font-semibold tracking-[0.18em] text-sky-300 uppercase">Fulfillment progress · contracted</h3>
            {business.fulfillment.length === 0 && <p className="text-xs text-zinc-500">No brief with contracted deliverables.</p>}
            {business.fulfillment.map((f) => (
              <div key={f.briefId} className="mt-1.5 text-xs text-zinc-300">
                <div className="flex items-center gap-1.5">
                  {f.partnerLabel} {f.dataStatus === "DEMO" && <FictionalBriefTag className="h-4 px-1 text-[9px]" />}
                </div>
                <div className="font-mono text-[11px] text-zinc-400">
                  {f.publishedBaseline + f.publishedViaPulse}/{f.contracted} published ({Math.round(f.coverage * 100)}%) ·{" "}
                  {f.publishedViaPulse} via PULSE · {f.deliverableReady} deliverable-ready · {f.remaining} open
                </div>
                <div className="text-[11px] text-zinc-500">
                  {f.openCommitmentAllocation
                    ? `Open commitment allocation ${f.openCommitmentAllocation.amount} ${f.openCommitmentAllocation.currency} — allocation of signed value, not new revenue`
                    : "No package value entered — deliverable counts only."}
                </div>
              </div>
            ))}
          </section>
          <section className="rounded-md border border-violet-500/30 bg-violet-500/5 p-2.5 text-xs text-zinc-300">
            <h3 className="text-[10px] font-semibold tracking-[0.18em] text-violet-300 uppercase">Potential upsell pipeline</h3>
            <p className="mt-1">
              {business.upsell.ideas} upsell idea(s) · {business.upsell.qualified} qualified (producer-approved + REROUTE ALLOWED)
            </p>
            <p className="font-mono text-[11px] text-violet-300">{business.upsell.label} · no proposed prices entered by sales</p>
            <p className="text-[11px] text-zinc-500">{COMMERCIAL.UPSELL_IDEA.hint}.</p>
          </section>
          <section className="rounded-md border border-white/10 p-2.5 text-xs text-zinc-300">
            <h3 className="text-[10px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">Efficiency</h3>
            <p className="mt-1">
              {business.efficiency.readyCount} approved · median time-to-ready {minutes(business.efficiency.medianTimeToReadyMinutes)} ·
              archive reuse {business.archiveActivation}
            </p>
            <p className="text-[11px] text-zinc-500">{business.efficiency.note}</p>
          </section>
        </div>
      </div>
      <div className="grid gap-3 border-t border-white/5 p-3 lg:grid-cols-2">
        <EfficiencyEstimate completed={business.efficiency.readyCount} />
        <ScenarioCalculator />
      </div>
    </Panel>
  );
}

function NumberField({ id, label, value, onChange, step = 1 }: { id: string; label: string; value: number; onChange: (n: number) => void; step?: number }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-[10px] tracking-widest text-zinc-500 uppercase">{label}</Label>
      <Input
        id={id}
        type="number"
        min={0}
        step={step}
        value={Number.isFinite(value) ? value : ""}
        onChange={(e) => onChange(e.target.valueAsNumber)}
        className="h-7 font-mono text-xs"
      />
    </div>
  );
}

const fmt = (n: number) => (Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "—");

function EfficiencyEstimate({ completed }: { completed: number }) {
  const [baseline, setBaseline] = useState(60);
  const [assisted, setAssisted] = useState(20);
  const [count, setCount] = useState(completed);
  const [hourly, setHourly] = useState(50);
  const saved = (baseline - assisted) * count;
  return (
    <section className="rounded-md border border-dashed border-white/15 p-2.5">
      <h3 className="text-[10px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">Labor savings estimate · your inputs</h3>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-4">
        <NumberField id="e-base" label="Manual baseline (min)" value={baseline} onChange={setBaseline} />
        <NumberField id="e-assist" label="Assisted (min)" value={assisted} onChange={setAssisted} />
        <NumberField id="e-count" label="Completed" value={count} onChange={setCount} />
        <NumberField id="e-cost" label="Loaded $/hour" value={hourly} onChange={setHourly} />
      </div>
      <p className="mt-2 font-mono text-xs text-zinc-200">
        {fmt(saved)} min saved ≈ ${fmt((saved / 60) * hourly)} estimated labor cost
      </p>
      <p className="text-[11px] text-amber-300/80">ESTIMATE from user-entered baseline — not measured, not revenue.</p>
    </section>
  );
}

function ScenarioCalculator() {
  const [matches, setMatches] = useState(20);
  const [concepts, setConcepts] = useState(2);
  const [cleared, setCleared] = useState(50);
  const [sold, setSold] = useState(25);
  const [price, setPrice] = useState(2500);
  const total = matches * concepts * (cleared / 100) * (sold / 100) * price;
  return (
    <section className="rounded-md border border-dashed border-amber-500/40 p-2.5">
      <h3 className="text-[10px] font-semibold tracking-[0.18em] text-amber-300 uppercase">
        Illustrative potential / not forecast / not booked revenue
      </h3>
      <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-5">
        <NumberField id="s-m" label="Matches" value={matches} onChange={setMatches} />
        <NumberField id="s-c" label="Concepts / match" value={concepts} onChange={setConcepts} />
        <NumberField id="s-cl" label="% cleared" value={cleared} onChange={setCleared} />
        <NumberField id="s-s" label="% sold" value={sold} onChange={setSold} />
        <NumberField id="s-p" label="$ / activation" value={price} onChange={setPrice} step={100} />
      </div>
      <p className="mt-2 font-mono text-xs text-zinc-200">
        {matches} × {concepts} × {cleared}% × {sold}% × ${fmt(price)} = ${fmt(total)} (scenario output only)
      </p>
      <p className="text-[11px] text-zinc-500">
        Hypothetical inputs; validate with real sales data before any ROI claim. Contracted deliverables are not counted here.
      </p>
    </section>
  );
}
