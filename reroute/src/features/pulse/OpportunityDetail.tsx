"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeftIcon, CheckIcon, ExternalLinkIcon, FilmIcon, Loader2Icon, RotateCcwIcon, SearchXIcon, ShieldQuestionIcon, XIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ErrorState, FictionalTag, Panel, PanelTitle, tcRange } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import { CLUBS } from "./clubs";
import { pulseApi } from "./client";
import { openDeliverables } from "./detect-opportunities";
import {
  COMMERCIAL,
  CommercialBadge,
  DELIVERABLE_LABEL,
  DemoBanner,
  FictionalBriefTag,
  IntelligenceNote,
  RIGHTS_MESSAGE,
  RIGHTS_TEXT_CLASS,
  evidenceLabel,
  PulseHeader,
  RightsBadge,
  STATUS_LABEL,
  ScoreDetails,
  SourceBadge,
  when,
} from "./pulse-ui";
import { MarketBlock, MarketEvidence, MarketScoreDetails } from "./MarketOpportunity";
import { CampaignProposal } from "./CampaignProposal";
import type { ActionRequest, OpportunityResponse, OpportunityView } from "./types";

type Busy = null | "handoff" | ActionRequest["action"];

export function OpportunityDetail({ id }: { id: string }) {
  const [data, setData] = useState<OpportunityResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [reviewer, setReviewer] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [dismissReason, setDismissReason] = useState("");

  useEffect(() => {
    let live = true;
    pulseApi.get(id).then(
      (d) => {
        if (!live) return;
        setData(d);
        setSelected(d.opportunity.ledger.handoff?.scoreplayAssetId ?? d.opportunity.media?.candidates[0]?.scoreplayAssetId ?? null);
      },
      (err) => live && setError(err),
    );
    return () => {
      live = false;
    };
  }, [id]);

  function patch(opportunity: OpportunityView) {
    setData((d) => d && { ...d, opportunity });
  }

  async function openInReroute(assetId = selected) {
    if (!assetId) return;
    setBusy("handoff");
    try {
      const res = await pulseApi.handoff(id, assetId);
      patch(res.opportunity);
      toast.info(`REROUTE verdict: ${res.opportunity.rightsState} — opening the rights desk`);
      window.location.assign(res.rerouteUrl);
    } catch (err) {
      setError(err);
      setBusy(null);
    }
  }

  async function draftCampaign(commerceUrl?: string) {
    if (!selected) return;
    setBusy("draftCampaign");
    try {
      const res = await pulseApi.draftCampaign({ id, action: "draftCampaign", scoreplayAssetId: selected, commerceUrl });
      setData((d) => d && { ...d, opportunity: res.opportunity, campaign: res.campaign });
      setError(null);
      toast.success("Campaign proposal drafted — review it, then send it to REROUTE");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  async function act(req: Exclude<ActionRequest, { action: "draftCampaign" }>, success: string) {
    setBusy(req.action);
    try {
      patch((await pulseApi.act(req)).opportunity);
      setError(null);
      toast.success(success);
    } catch (err) {
      setError(err);
      // The server records the fresh REROUTE verdict even when it refuses the action.
      await pulseApi.get(id).then((d) => setData(d), () => undefined);
    } finally {
      setBusy(null);
    }
  }

  const o = data?.opportunity;
  const brief = data?.brief;

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(ellipse_at_top,rgba(56,189,248,0.07),transparent_60%)]">
      <PulseHeader
        right={
          <Link href="/pulse/board" className="flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100">
            <ArrowLeftIcon className="size-3.5" /> Board
          </Link>
        }
      />
      {data && <DemoBanner meta={data.meta} />}
      <main className="flex flex-1 flex-col gap-3 p-3">
        {error !== null && <ErrorState error={error} />}
        {!o && error === null && (
          <div className="flex items-center gap-2 p-6 text-sm text-zinc-400">
            <Loader2Icon className="size-4 animate-spin" /> Loading opportunity…
          </div>
        )}
        {o && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-zinc-50">{o.headline}</h1>
              <RightsBadge state={o.rightsState} />
              <CommercialBadge state={o.commercialState} />
              <SourceBadge mode={o.evidenceMode} />
              <span className="font-mono text-[11px] text-zinc-500">{STATUS_LABEL[o.status]}</span>
            </div>
            <p className="-mt-2 text-xs text-zinc-500">
              {CLUBS[o.club].label} · {o.game} · {o.focus}
            </p>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
              {/* LEFT: evidence */}
              <Panel aria-labelledby="p-evidence">
                <PanelTitle step="01">
                  <span id="p-evidence">Evidence · provenance</span>
                </PanelTitle>
                <div className="space-y-3 p-3 text-xs">
                  <p className="text-zinc-300">{o.interestSummary}</p>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
                    <dt className="text-zinc-500">Source</dt>
                    <dd className="text-zinc-300">
                      {o.signal.source} ({o.signal.mode})
                    </dd>
                    <dt className="text-zinc-500">Sample size</dt>
                    <dd className="text-zinc-300">{o.signal.sampleCount} post(s)</dd>
                    <dt className="text-zinc-500">Confidence</dt>
                    <dd className="text-zinc-300">{o.signal.confidence} (sample-size based)</dd>
                    <dt className="text-zinc-500">Latest</dt>
                    <dd className="text-zinc-300">{when(o.signal.observedAt)}</dd>
                  </dl>
                  <ul className="space-y-2">
                    {o.signal.samples.map((s) => (
                      <li key={s.id} className="rounded-md border border-white/8 bg-black/30 p-2">
                        <p className="text-zinc-200">“{s.text}”</p>
                        <p className="mt-1 font-mono text-[10px] text-zinc-500">
                          {s.id} · {s.platformLabel} · {when(s.postedAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-zinc-500">
                    Not a representative view of all fans. Audience is a discussion cohort, never inferred individuals.
                  </p>
                  {o.market?.analysis && <MarketEvidence analysis={o.market.analysis} />}
                </div>
              </Panel>

              {/* CENTER: story + candidates */}
              <Panel aria-labelledby="p-story">
                <PanelTitle step="02">
                  <span id="p-story">Suggested story · candidate footage</span>
                </PanelTitle>
                <div className="space-y-3 p-3 text-xs">
                  <div>
                    <p className="text-sm text-zinc-100">{o.angle}</p>
                    <p className="mt-1 text-[11px] text-zinc-500">
                      Audience cohort: {o.targetAudienceCohort} · format {o.desiredFormat.replace("_", " ")}
                    </p>
                  </div>
                  {o.market && <MarketBlock fit={o.market} />}
                  <CandidateList o={o} selected={selected} onSelect={setSelected} />
                  {o.media && (
                    <>
                      <IntelligenceNote media={o.media} />
                      <details className="text-[10px] text-zinc-500">
                        <summary className="cursor-pointer">Technical details (developers)</summary>
                        <ul className="mt-1 space-y-0.5 font-mono">
                          {o.media.attempts.map((a, i) => (
                            <li key={i}>
                              {a.service} “{a.query}” → {a.outcome}
                              {a.code && ` [${a.code}]`}
                              {a.detail && <span className="text-zinc-600"> · {a.detail}</span>}
                            </li>
                          ))}
                          {o.media.intelligence.code && <li>video intelligence: {o.media.intelligence.code}</li>}
                          <li>searched {when(o.media.searchedAt)}</li>
                        </ul>
                      </details>
                    </>
                  )}
                  {o.market && <MarketScoreDetails fit={o.market} />}
                  <ScoreDetails score={o.score} />
                </div>
              </Panel>

              {/* RIGHT: commercial + rights + actions */}
              <div className="flex flex-col gap-3">
                <Panel aria-labelledby="p-commercial">
                  <PanelTitle step="03">
                    <span id="p-commercial">Sponsor objective · business value</span>
                  </PanelTitle>
                  <div className="space-y-2 p-3 text-xs text-zinc-300">
                    {brief ? (
                      <>
                        <div className="flex flex-wrap items-center gap-1.5 font-medium text-zinc-100">
                          {brief.partnerLabel} {brief.dataStatus === "DEMO" && <FictionalBriefTag />}
                        </div>
                        <p>{brief.objective}</p>
                        {brief.contractedDeliverables !== undefined ? (
                          <p className="font-mono text-[11px]">
                            {brief.publishedDeliverables ?? 0}/{brief.contractedDeliverables} contracted deliverables published ·{" "}
                            {openDeliverables(brief)} open{brief.dueBy && ` · due ${when(brief.dueBy)}`}
                          </p>
                        ) : (
                          <p className="font-mono text-[11px] text-violet-300">No contract — PROPOSED / NOT SOLD</p>
                        )}
                        {brief.disclaimer && <p className="text-[11px] text-amber-300/80">{brief.disclaimer}</p>}
                      </>
                    ) : (
                      <p>No sponsor brief — brand/editorial suggestion.</p>
                    )}
                    <p className="text-[11px] text-zinc-400">{o.commercialRationale}</p>
                    <p className="text-[11px] text-zinc-500">
                      Value category: {COMMERCIAL[o.commercialState].hint}.
                      {DELIVERABLE_LABEL[o.deliverableState] && ` ${DELIVERABLE_LABEL[o.deliverableState]}.`}
                    </p>
                    <p className="text-[11px] text-zinc-500">A sponsor brief is never a rights grant.</p>
                    {data?.objective && (
                      <p className="text-[11px] text-amber-300/90">
                        KPI {data.objective.kpi}: measurement not connected — no sales effect is claimed.
                      </p>
                    )}
                  </div>
                </Panel>

                <Panel aria-labelledby="p-rights">
                  <PanelTitle step="04">
                    <span id="p-rights">Rights readiness · from REROUTE</span>
                  </PanelTitle>
                  <RightsPanel o={o} />
                </Panel>

                <Panel aria-labelledby="p-actions">
                  <PanelTitle step="05">
                    <span id="p-actions">Producer action</span>
                  </PanelTitle>
                  <div className="space-y-3 p-3 text-xs">
                    {o.status !== "DISMISSED" && o.status !== "PUBLISHED" && (
                      <Button className="w-full" disabled={!selected || busy !== null} onClick={() => void openInReroute()}>
                        {busy === "handoff" ? <Loader2Icon className="animate-spin" /> : <ExternalLinkIcon />}
                        Open in REROUTE
                      </Button>
                    )}
                    {o.ledger.handoff && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy !== null}
                          onClick={() => void act({ id, action: "recheck" }, "Rights re-checked with REROUTE")}
                        >
                          <ShieldQuestionIcon /> Re-check with REROUTE
                        </Button>
                        <Button size="sm" variant="ghost" render={<Link href={o.ledger.handoff.rerouteUrl} />} nativeButton={false}>
                          Resume in REROUTE
                        </Button>
                      </div>
                    )}

                    {o.status === "SENT_TO_REROUTE" && (
                      <form
                        className="space-y-1.5 border-t border-white/5 pt-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act({ id, action: "approve", reviewer }, "Approved — rights-eligible candidate recorded");
                        }}
                      >
                        <Label htmlFor="a-rev" className="text-[10px] tracking-widest text-zinc-500 uppercase">Approve as</Label>
                        <div className="flex gap-2">
                          <Input id="a-rev" value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="producer name" required maxLength={80} />
                          <Button type="submit" size="sm" disabled={busy !== null || o.rightsState !== "ALLOWED" || !reviewer.trim()}>
                            <CheckIcon /> Approve
                          </Button>
                        </div>
                        {o.rightsState !== "ALLOWED" && (
                          <p className="text-[11px] text-amber-300">Approval needs an ALLOWED verdict from REROUTE ({RIGHTS_MESSAGE[o.rightsState]}).</p>
                        )}
                      </form>
                    )}

                    {o.status === "APPROVED" && (
                      <form
                        className="space-y-1.5 border-t border-white/5 pt-3"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void act({ id, action: "publish", evidenceUrl }, "Publication recorded with evidence");
                        }}
                      >
                        <Label htmlFor="a-url" className="text-[10px] tracking-widest text-zinc-500 uppercase">
                          Record publication (published outside PULSE)
                        </Label>
                        <div className="flex gap-2">
                          <Input id="a-url" type="url" value={evidenceUrl} onChange={(e) => setEvidenceUrl(e.target.value)} placeholder="https://… live post URL" required />
                          <Button type="submit" size="sm" disabled={busy !== null || !evidenceUrl}>
                            Record
                          </Button>
                        </div>
                        <p className="text-[11px] text-zinc-500">PULSE never posts. REROUTE is re-asked before the record is accepted.</p>
                      </form>
                    )}

                    {o.status === "PUBLISHED" && o.ledger.publishEvidenceUrl && (
                      <p className="text-emerald-300">
                        Published {o.ledger.publishedAt && when(o.ledger.publishedAt)} ·{" "}
                        <a href={o.ledger.publishEvidenceUrl} target="_blank" rel="noreferrer" className="underline">
                          evidence
                        </a>
                      </p>
                    )}

                    {o.status === "DISMISSED" ? (
                      <div className="flex items-center justify-between gap-2 border-t border-white/5 pt-3">
                        <span className="text-zinc-400">Dismissed{o.ledger.dismissReason && `: ${o.ledger.dismissReason}`}</span>
                        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void act({ id, action: "restore" }, "Opportunity restored")}>
                          <RotateCcwIcon /> Restore
                        </Button>
                      </div>
                    ) : (
                      o.status !== "PUBLISHED" && (
                        <form
                          className="flex gap-2 border-t border-white/5 pt-3"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void act({ id, action: "dismiss", reason: dismissReason || undefined }, "Opportunity dismissed");
                          }}
                        >
                          <Input value={dismissReason} onChange={(e) => setDismissReason(e.target.value)} placeholder="Not relevant because… (optional)" maxLength={280} aria-label="Dismiss reason" />
                          <Button type="submit" size="sm" variant="destructive" disabled={busy !== null}>
                            <XIcon /> Dismiss
                          </Button>
                        </form>
                      )
                    )}
                  </div>
                </Panel>
              </div>
            </div>

            <CampaignProposal
              o={o}
              objective={data?.objective}
              campaign={data?.campaign}
              selected={selected}
              busy={busy !== null}
              onDraft={(url) => void draftCampaign(url)}
              onSend={(assetId) => void openInReroute(assetId)}
            />
          </>
        )}
      </main>
    </div>
  );
}

function CandidateList({ o, selected, onSelect }: { o: OpportunityView; selected: string | null; onSelect: (id: string) => void }) {
  const candidates = o.media?.candidates ?? [];
  if (candidates.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-amber-200">
        <SearchXIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          {o.media?.intelligence.message ?? "Media not searched yet."} Nothing can be sent to REROUTE until a ScorePlay video exists.
        </span>
      </div>
    );
  }
  const locked = o.status === "DISMISSED" || o.status === "PUBLISHED";
  return (
    <fieldset className="space-y-2" disabled={locked}>
      <legend className="mb-1 text-[10px] tracking-widest text-zinc-500 uppercase">Candidate footage (select one)</legend>
      {candidates.map((c) => (
        <label
          key={`${c.scoreplayAssetId}-${c.startSeconds ?? ""}`}
          className={cn(
            "flex cursor-pointer gap-3 rounded-md border p-2",
            selected === c.scoreplayAssetId ? "border-sky-500/60 bg-sky-500/10" : "border-white/8 bg-black/30 hover:border-white/20",
          )}
        >
          <input
            type="radio"
            name="candidate"
            className="sr-only"
            checked={selected === c.scoreplayAssetId}
            onChange={() => onSelect(c.scoreplayAssetId)}
          />
          <div className="flex h-16 w-28 shrink-0 items-center justify-center overflow-hidden rounded bg-black">
            {c.thumbnailUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- authorized ScorePlay/TwelveLabs thumbnail reference
              <img src={c.thumbnailUrl} alt="" className="size-full object-cover" />
            ) : (
              <FilmIcon className="size-5 text-zinc-600" aria-hidden />
            )}
          </div>
          <div className="min-w-0">
            <p className="truncate text-zinc-100">{c.title}</p>
            <p className="font-mono text-[10px] text-zinc-500">
              ScorePlay {c.scoreplayAssetId} · {c.foundBy === "TWELVELABS" ? `moment ${tcRange(c.startSeconds, c.endSeconds)}` : "no moment timecodes"}
              {c.durationSec !== undefined && ` · ${Math.round(c.durationSec)} s asset`}
            </p>
            <p className={cn("font-mono text-[10px]", c.foundBy === "TWELVELABS" ? "text-sky-300" : "text-zinc-500")}>
              {evidenceLabel(c)}
              {c.competition && ` · ${c.competition}`}
            </p>
            {c.mapping?.via === "FILENAME_DURATION" && (
              <p className="font-mono text-[10px] text-amber-300/80" title={c.mapping.filename}>
                linked to TwelveLabs by exact filename + duration
              </p>
            )}
          </div>
        </label>
      ))}
    </fieldset>
  );
}

function RightsPanel({ o }: { o: OpportunityView }) {
  const r = o.ledger.rights;
  if (!r) {
    return (
      <div className="space-y-1 p-3 text-xs text-zinc-400">
        <p>
          <strong className="text-amber-300">Needs clearance.</strong> REROUTE has not evaluated a candidate yet. Fan interest
          and sponsor fit never imply permission.
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-2 p-3 text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        <RightsBadge state={o.rightsState} />
        <span className={RIGHTS_TEXT_CLASS[o.rightsState]}>
          {RIGHTS_MESSAGE[o.rightsState]}
        </span>
      </div>
      <p className="font-mono text-[10px] text-zinc-500">
        asset {r.scoreplayAssetId} · policy {r.policyId} v{r.policyVersion} · {when(r.checkedAt)}
      </p>
      {r.policyFictional && <FictionalTag />}
      {o.ledger.handoff && (
        <p className="font-mono text-[10px] text-zinc-500">
          intent {o.ledger.handoff.intent.territory} · {o.ledger.handoff.intent.platform} · {o.ledger.handoff.intent.usage} ·{" "}
          {o.ledger.handoff.intent.competition} · cut {tcRange(o.ledger.handoff.edit.segments[0]?.start, o.ledger.handoff.edit.segments[0]?.end)}
        </p>
      )}
      {r.reasons.length > 0 && (
        <ul className="space-y-1">
          {r.reasons.map((reason, i) => (
            <li key={i} className={reason.outcome === "DENY" ? "text-red-300" : "text-amber-200"}>
              <span className="font-mono text-[10px] opacity-70">
                {reason.outcome} · {reason.dimension}
              </span>{" "}
              {reason.explanation}
            </li>
          ))}
        </ul>
      )}
      {r.missingFacts.length > 0 && (
        <p className="text-[11px] text-zinc-400">Missing: {r.missingFacts.join("; ")}</p>
      )}
      {o.rightsState !== "ALLOWED" && (
        <p className="text-[11px] text-zinc-500">
          Resolve in REROUTE (observations, alternatives, review), then re-check. PULSE cannot override this verdict.
        </p>
      )}
    </div>
  );
}
