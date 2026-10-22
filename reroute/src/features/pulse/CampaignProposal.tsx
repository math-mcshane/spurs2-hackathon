"use client";

import { useState } from "react";
import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon, MegaphoneIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FictionalTag, Panel, PanelTitle, tcRange } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import { RightsBadge, when } from "./pulse-ui";
import type { CampaignView, Channel, OpportunityView, ParsedObjective } from "./types";

const CHANNEL_LABEL: Record<Channel, string> = { instagram: "Instagram", facebook: "Facebook", x: "X" };
const MEASUREMENT_LABEL: Record<CampaignView["objective"]["measurement"]["status"], string> = {
  NOT_CONNECTED: "Not connected",
  PLATFORM_NATIVE: "Platform analytics (not connected)",
  TRACKED_IN_PULSE: "Tracked in PULSE ledger",
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] gap-2 border-b border-white/5 py-1.5 text-xs last:border-0">
      <div className="text-[10px] tracking-[0.16em] text-zinc-500 uppercase">{label}</div>
      <div className="min-w-0 text-zinc-200">{children}</div>
    </div>
  );
}

export function CopyBlock({ channel }: { channel: CampaignView["channels"][number] }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-md border border-white/8 bg-black/30 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-100">{CHANNEL_LABEL[channel.channel]}</span>
        <span className={cn("font-mono text-[10px]", channel.withinLimit ? "text-zinc-500" : "text-red-300")}>
          {channel.characterCount}
          {channel.limit ? ` / ${channel.limit}` : ""} chars
        </span>
      </div>
      <div className="font-mono text-[10px] text-zinc-500">{channel.format}</div>
      <p className="text-xs whitespace-pre-wrap text-zinc-200">{channel.copy}</p>
      <p className="text-[10px] text-zinc-500">{channel.linkHandling}</p>
      <Button
        size="xs"
        variant="ghost"
        className="self-start"
        onClick={async () => {
          await navigator.clipboard.writeText(channel.copy);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <CheckIcon /> : <CopyIcon />} Copy text
      </Button>
    </div>
  );
}

/**
 * Campaign proposal on the opportunity detail page: draft from the active objective + selected
 * ScorePlay clip; send to REROUTE uses the existing handoff. No publish or ad-buy action exists.
 */
export function CampaignProposal({
  o,
  objective,
  campaign,
  selected,
  busy,
  onDraft,
  onSend,
}: {
  o: OpportunityView;
  objective?: ParsedObjective;
  campaign?: CampaignView;
  selected: string | null;
  busy: boolean;
  onDraft: (commerceUrl?: string) => void;
  onSend: (scoreplayAssetId: string) => void;
}) {
  const [commerceUrl, setCommerceUrl] = useState("");
  const locked = o.status === "DISMISSED" || o.status === "PUBLISHED";
  const c = campaign;
  const draftedOther = c && selected && c.media.scoreplayAssetId !== selected;

  return (
    <Panel aria-labelledby="p-campaign">
      <PanelTitle
        step="06"
        right={c && <span className="font-mono text-[10px] text-zinc-500">draft {c.id} · updated {when(c.updatedAt)}</span>}
      >
        <span id="p-campaign" className="flex items-center gap-1.5">
          <MegaphoneIcon className="size-3.5" aria-hidden /> Campaign proposal · draft
        </span>
      </PanelTitle>
      <div className="space-y-3 p-3">
        {!objective ? (
          <p className="text-xs text-amber-300">Set a business objective on the board first — the proposal is built for an objective.</p>
        ) : (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              onDraft(commerceUrl.trim() || undefined);
            }}
          >
            <div className="min-w-72 flex-1 space-y-1">
              <Label htmlFor="c-url" className="text-[10px] tracking-widest text-zinc-500 uppercase">
                Authorized store / ticketing URL (optional, https)
              </Label>
              <Input
                id="c-url"
                type="url"
                pattern="https://.*"
                value={commerceUrl}
                onChange={(e) => setCommerceUrl(e.target.value)}
                placeholder="Leave empty to use the club-configured destination"
              />
            </div>
            <Button type="submit" disabled={busy || locked || !selected || !o.media?.candidates.length}>
              {busy ? <Loader2Icon className="animate-spin" /> : <MegaphoneIcon />}
              {c ? "Regenerate proposal" : "Generate campaign proposal"}
            </Button>
            <span className="text-[11px] text-zinc-500">for “{objective.summary}” with the selected clip</span>
          </form>
        )}

        {c && (
          <>
            {(c.stale || draftedOther) && (
              <div role="status" className="flex items-center gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-200">
                <TriangleAlertIcon className="size-3.5" aria-hidden />
                {c.stale
                  ? `Drafted for “${c.objective.summary}”; the active objective changed — regenerate.`
                  : "This draft uses a different clip than the one selected — regenerate to switch."}
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="outline" className="rounded-sm border-sky-500/50 bg-sky-500/10 font-mono text-[10px] text-sky-300">
                DRAFT — REVIEW BEFORE USE
              </Badge>
              {c.evidenceLabels.map((l) => (
                <Badge
                  key={l}
                  variant="outline"
                  className={cn(
                    "rounded-sm font-mono text-[10px]",
                    /SIMULATED|FICTIONAL|not localized/.test(l) ? "border-amber-500/60 bg-amber-500/10 text-amber-300" : "border-zinc-600 text-zinc-300",
                  )}
                >
                  {l}
                </Badge>
              ))}
            </div>

            <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <div>
                <Row label="Objective">{c.objective.summary}</Row>
                <Row label="Primary KPI">
                  {c.objective.kpi}
                  <span className="block text-[11px] text-amber-300/90">
                    Measurement: {MEASUREMENT_LABEL[c.objective.measurement.status]} — {c.objective.measurement.note}
                  </span>
                </Row>
                <Row label="Audience">
                  {c.audience.market ? `${c.audience.market.label} (${c.audience.market.code})` : c.audience.scope === "GLOBAL" ? "Global" : "Not specified"}
                  {" · "}
                  {c.audience.cohort} · copy in {c.audience.language.toUpperCase()}
                  <span className="block text-[11px] text-zinc-500">{c.audience.basis}</span>
                </Row>
                <Row label="Media">
                  <div className="flex gap-2">
                    {c.media.thumbnailUrl && (
                      // eslint-disable-next-line @next/next/no-img-element -- authorized ScorePlay/TwelveLabs thumbnail reference
                      <img src={c.media.thumbnailUrl} alt="" className="h-12 w-20 shrink-0 rounded object-cover" />
                    )}
                    <div className="min-w-0">
                      <div className="truncate">{c.media.title}</div>
                      <div className="font-mono text-[10px] text-zinc-500">
                        ScorePlay {c.media.scoreplayAssetId} · cut {tcRange(c.media.startSeconds, c.media.endSeconds)} · {c.media.foundBy} ·{" "}
                        {c.media.origin}
                      </div>
                    </div>
                  </div>
                </Row>
                <Row label="Why this media">
                  <ul className="list-disc space-y-0.5 pl-4">
                    {c.rationale.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </Row>
                <Row label="Creative angle">
                  {c.creative.angle}
                  <span className="block text-[11px] text-zinc-400">Hook ({c.creative.hookLanguage}): “{c.creative.hook}”</span>
                </Row>
                <Row label="CTA">
                  {c.cta.status === "NOT_CONFIGURED" ? (
                    <span className="text-amber-300">{c.cta.note}</span>
                  ) : (
                    <>
                      {c.cta.text}
                      {c.cta.destination && (
                        <a href={c.cta.destination.url} target="_blank" rel="noreferrer" className="ml-1 inline-flex items-center gap-0.5 text-sky-300 underline">
                          {c.cta.destination.url} <ExternalLinkIcon className="size-3" />
                        </a>
                      )}
                      <span className="block text-[11px] text-zinc-500">{c.cta.note}</span>
                    </>
                  )}
                </Row>
              </div>

              <div className="space-y-3">
                <div className="rounded-md border border-white/10 p-2 text-xs">
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">Rights · from REROUTE only</span>
                    <RightsBadge state={c.rights.state} />
                  </div>
                  <p className="text-[11px] text-zinc-400">{c.rights.note}</p>
                  {c.rights.policyId && (
                    <p className="mt-1 flex items-center gap-1.5 font-mono text-[10px] text-zinc-500">
                      policy {c.rights.policyId} · {c.rights.checkedAt && when(c.rights.checkedAt)}
                      {c.rights.policyFictional && <FictionalTag className="h-4 px-1 text-[9px]" />}
                    </p>
                  )}
                  <p className="mt-1 font-mono text-[10px] text-zinc-500">
                    REROUTE intent: {c.rerouteIntent.territory} · {c.rerouteIntent.platform} · {c.rerouteIntent.usage} · {c.rerouteIntent.competition}
                  </p>
                  {c.audience.scope === "GLOBAL" && (
                    <p className="mt-1 text-[11px] text-amber-300/90">
                      A global post has no single territory: REROUTE checks {c.rerouteIntent.territory}; check every other territory before posting there.
                    </p>
                  )}
                  <Button
                    className="mt-2 w-full"
                    disabled={busy || locked || !!draftedOther || c.stale}
                    onClick={() => onSend(c.media.scoreplayAssetId)}
                  >
                    <ShieldCheckIcon /> {c.rights.matchesDraft ? "Re-open in REROUTE" : "Send proposal to REROUTE"}
                  </Button>
                  <p className="mt-1 text-[10px] text-zinc-500">
                    Approval and publication stay gated on an ALLOWED verdict. PULSE never posts or buys ads.
                  </p>
                </div>
                <div className="grid gap-2">
                  {c.channels.map((ch) => (
                    <CopyBlock key={ch.channel} channel={ch} />
                  ))}
                </div>
              </div>
            </div>

            <details className="text-[11px] text-zinc-500">
              <summary className="cursor-pointer">What PULSE did not do</summary>
              <ul className="mt-1 list-disc pl-4">
                {c.safeguards.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </div>
    </Panel>
  );
}
