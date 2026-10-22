"use client";

import { useState } from "react";
import { ExternalLinkIcon, GaugeIcon, Loader2Icon, TimerIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { clock } from "../moment-ranking";
import type { GoalView } from "../types";
import { displayTitle } from "./MomentCard";
import { MomentPreview, recommendationSource } from "./MomentPreview";
import { CHANNEL_LABEL, Field, duration } from "./parts";

type Campaign = NonNullable<GoalView["campaign"]>;

/** Step 4: the campaign proposal for the selected moment. Nothing here publishes or buys anything. */
export function Proposal({ goal, campaign: c, busy, onSetDestination }: { goal: GoalView; campaign: Campaign; busy: boolean; onSetDestination: (url: string) => void }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="min-w-0 space-y-4">
        <MomentPreview
          key={c.key}
          source={
            goal.selected
              ? recommendationSource(goal.selected)
              : {
                  title: c.media.title,
                  scoreplayAssetId: c.media.scoreplayAssetId,
                  thumbnailUrl: c.media.thumbnailUrl,
                  start: c.media.startSeconds,
                  end: c.media.endSeconds,
                  note: "No playable stream is available for this moment.",
                }
          }
        />
        <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4 text-xs">
          <h3 className="text-sm font-semibold text-zinc-50">{displayTitle(c.media.title)}</h3>
          <p className="font-mono text-[11px] text-zinc-500">
            cut {clock(c.media.startSeconds)}–{clock(c.media.endSeconds)} · {(c.media.endSeconds - c.media.startSeconds).toFixed(1)} s, exact TwelveLabs timestamps
          </p>
          <h4 className="mt-3 text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Why this media</h4>
          <ul className="mt-1 list-disc space-y-1 pl-4 text-zinc-300">
            {c.rationale.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
        <Metrics goal={goal} />
      </div>

      <div className="min-w-0 space-y-4">
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 rounded-xl border border-white/10 bg-zinc-950/60 p-4 text-xs sm:grid-cols-2">
          <Field label="Creative angle">{c.creative.angle}</Field>
          <Field label={`Hook · ${c.creative.hookLanguage.toUpperCase()}`}>“{c.creative.hook}”</Field>
          <Field label="Audience">
            {c.audience.market ? `${c.audience.market.label} (${c.audience.market.code})` : c.audience.scope === "GLOBAL" ? "Global" : "Not specified"} · {c.audience.cohort}
          </Field>
          <Field label="Rights will be checked for">
            {c.plan.channels.map((ch) => CHANNEL_LABEL[ch] ?? ch).join(", ")} × {c.plan.territories.join(", ")} · {c.plan.usage.toLowerCase()} use
            <span className="block text-[11px] text-zinc-500">{c.plan.territoryBasis}</span>
          </Field>
        </div>

        <ChannelCopy campaign={c} />
        <Cta campaign={c} busy={busy} onSetDestination={onSetDestination} />
      </div>
    </div>
  );
}

function ChannelCopy({ campaign: c }: { campaign: Campaign }) {
  const first = c.channels[0]?.channel;
  if (!first) return null;
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4">
      <Tabs defaultValue={first}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Localized copy · {c.audience.language.toUpperCase()}</h3>
          <TabsList aria-label="Channel">
            {c.channels.map((ch) => (
              <TabsTrigger key={ch.channel} value={ch.channel} className="text-xs">
                {CHANNEL_LABEL[ch.channel] ?? ch.channel}
                {!ch.withinLimit && <TriangleAlertIcon className="size-3 text-amber-300" aria-label="over the character limit" />}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
        {c.channels.map((ch) => (
          <TabsContent key={ch.channel} value={ch.channel} className="mt-2 space-y-2 text-xs">
            <p className="text-[11px] text-zinc-500">{ch.format}</p>
            <p className="rounded-lg border border-white/8 bg-black/30 p-3 text-sm whitespace-pre-wrap text-zinc-100">{ch.copy}</p>
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="text-zinc-500">{ch.linkHandling}</span>
              <span className={cn("font-mono", ch.withinLimit ? "text-zinc-400" : "text-amber-300")}>
                {ch.characterCount}
                {ch.limit !== undefined && ` / ${ch.limit}`} characters{!ch.withinLimit && " — over the limit"}
              </span>
            </div>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function Cta({ campaign: c, busy, onSetDestination }: { campaign: Campaign; busy: boolean; onSetDestination: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return (
    <div className="space-y-2 rounded-xl border border-white/10 bg-zinc-950/60 p-4 text-xs">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <Field label="Call to action">
          <span className="text-sm">{c.cta.text}</span>
        </Field>
        {c.cta.destination ? (
          <a href={c.cta.destination.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-sky-300 underline">
            {c.cta.destination.url} <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
          </a>
        ) : c.cta.status === "NOT_CONFIGURED" ? (
          <span className="inline-flex items-center gap-1 text-amber-300">
            <TriangleAlertIcon className="size-3.5" aria-hidden /> No destination link yet
          </span>
        ) : null}
      </div>
      <p className="text-[11px] text-zinc-500">{c.cta.note}</p>
      {c.cta.status !== "NOT_APPLICABLE" && (
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (url.trim()) onSetDestination(url.trim());
          }}
        >
          <Label htmlFor="cta-url" className="sr-only">
            Club-approved destination link (https)
          </Label>
          <Input id="cta-url" type="url" pattern="https://.*" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… club store link" />
          <Button type="submit" variant="outline" disabled={busy || !url.trim()}>
            {busy && <Loader2Icon className="animate-spin" />}
            {c.cta.destination ? "Replace link" : "Add link"}
          </Button>
        </form>
      )}
    </div>
  );
}

function Metrics({ goal }: { goal: GoalView }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
          <GaugeIcon className="size-3.5" aria-hidden /> Primary KPI
        </div>
        <div className="mt-1 text-sm font-medium text-zinc-100">{goal.kpi.label}</div>
        <div className="mt-1 font-mono text-2xl text-zinc-500" aria-label="No measured value yet">
          —
        </div>
        <p className="text-[11px] text-zinc-500">{goal.kpi.note}</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
          <TimerIcon className="size-3.5" aria-hidden /> Goal → proposal
        </div>
        <div className="mt-1 font-mono text-2xl text-zinc-50">{goal.timing.toProposalSec !== undefined ? duration(goal.timing.toProposalSec) : "—"}</div>
        <p className="text-[11px] text-zinc-500">
          Measured by the server from goal submission to the first proposal (moments in {duration(goal.timing.toRecommendationsSec)}). No manual baseline is
          assumed, so no time saving is claimed.
        </p>
      </div>
    </div>
  );
}
