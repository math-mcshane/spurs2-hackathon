"use client";

import { useState } from "react";
import { ArrowLeftRightIcon, ExternalLinkIcon, Loader2Icon } from "lucide-react";
import { Swap } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { CLUBS } from "../clubs";
import { clock } from "../moment-ranking";
import type { GoalView } from "../types";
import { EditPlanView, momentSpan } from "./ComplianceEditor";
import { MomentPreview, recommendationSource } from "./MomentPreview";
import { CHANNEL_LABEL, channelList, country, displayTitle, usageWord } from "./parts";

type Campaign = NonNullable<GoalView["campaign"]>;

/**
 * The selected moment, large: what the campaign is built on. Swaps in place when a replacement is adopted; a
 * derived cut is marked as an edit plan (never a rendered file) with its before/after.
 */
export function MediaStage({ goal, campaign: c, onChangeMoment }: { goal: GoalView; campaign: Campaign; onChangeMoment: () => void }) {
  const edit = goal.edit;
  const replacement = c.origin === "ALTERNATIVE" || (goal.beforeAfter?.kind === "REPLACE" && goal.beforeAfter.after?.key === c.key);
  const len = c.media.endSeconds - c.media.startSeconds;
  const context = [CLUBS[goal.run.club].label, goal.run.match && `v ${goal.run.match}`, goal.selected?.season].filter(Boolean).join(" · ");
  return (
    <Swap id={`${c.key}:${edit?.edlId ?? ""}`}>
      <MomentPreview
        size="stage"
        label={edit ? "Edited cut" : replacement ? "Replacement moment · re-checked" : "Campaign moment"}
        source={
          goal.selected
            ? { ...recommendationSource(goal.selected), ...(edit && { start: edit.original.start, end: edit.original.end, skip: edit.removed }) }
            : {
                title: c.media.title,
                scoreplayAssetId: c.media.scoreplayAssetId,
                start: edit?.original.start ?? c.media.startSeconds,
                end: edit?.original.end ?? c.media.endSeconds,
                note: "No playable stream is available for this moment.",
              }
        }
      />
      <div className="mt-5 flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 className="font-display text-title font-medium text-ink" title={c.media.title}>
            {displayTitle(c.media.title)}
          </h2>
          <p className="tabular mt-2 text-small text-ink-muted">
            {!edit
              ? `${clock(c.media.startSeconds)}–${clock(c.media.endSeconds)} · ${len.toFixed(1)} s cut`
              : edit.removed.length > 0
                ? `Edited cut · ${edit.resultDurationSec.toFixed(1)} s of ${edit.originalDurationSec.toFixed(1)} s`
                : `${clock(edit.original.start)}–${clock(edit.original.end)} · clean section · ${edit.resultDurationSec.toFixed(1)} s`}
            {context && <span> · {context}</span>}
          </p>
        </div>
        <Button variant="ghost" size="sm" className="text-ink-muted" onClick={onChangeMoment}>
          <ArrowLeftRightIcon /> Change moment
        </Button>
      </div>
      {edit && <EditPlanView timeline={edit} chosen={goal.beforeAfter && momentSpan(goal, goal.beforeAfter.before.key)} compact className="mt-5 max-w-xl" />}
    </Swap>
  );
}

/**
 * The campaign draft as a brief: hook, audience, KPI, uses, per-channel copy and the destination link. It is a
 * proposal — nothing here publishes or buys anything. Only the destination link is edited here.
 */
export function CampaignBrief({
  goal,
  campaign: c,
  busy,
  saving,
  onSetDestination,
}: {
  goal: GoalView;
  campaign: Campaign;
  /** Any action is running. */
  busy: boolean;
  /** The destination link is being saved. */
  saving: boolean;
  onSetDestination: (url: string) => void;
}) {
  const audience = c.audience.market ? c.audience.market.label : c.audience.scope === "GLOBAL" ? "Global" : "Not specified";
  return (
    <section aria-labelledby="brief-title" className="border-t border-line pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="brief-title" className="font-display text-headline font-medium text-ink">
          Campaign draft
        </h2>
        <p className="text-meta text-ink-muted">Version {c.version} · a proposal, nothing is published</p>
      </div>

      <figure className="mt-6">
        <blockquote className="font-display text-[1.625rem] leading-tight font-medium tracking-[-0.02em] text-ink sm:text-[1.875rem]">“{c.creative.hook}”</blockquote>
        <figcaption className="mt-2 max-w-2xl text-small text-ink-muted">{c.creative.angle}</figcaption>
      </figure>

      <dl className="mt-8 grid grid-cols-1 gap-x-10 gap-y-5 border-y border-line py-6 sm:grid-cols-2">
        <Fact label="Audience">
          {audience} · {c.audience.cohort}
        </Fact>
        <Fact label="Primary KPI">
          {goal.kpi.label}
          <span className="mt-0.5 block text-meta text-ink-muted">{goal.kpi.valueText}</span>
        </Fact>
        <Fact label="Rights checked for">
          {channelList(c.plan.channels)} · {c.plan.territories.map(country).join(", ")}
          <span className="mt-0.5 block text-meta text-ink-muted first-letter:uppercase">{usageWord(c.plan.usage)} use</span>
        </Fact>
        <Fact label="Call to action">{c.cta.text}</Fact>
      </dl>

      <ChannelCopy campaign={c} />
      {c.cta.status !== "NOT_APPLICABLE" && <Destination campaign={c} busy={busy} saving={saving} onSetDestination={onSetDestination} />}
    </section>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-meta text-ink-muted">{label}</dt>
      <dd className="mt-1 text-body break-words text-ink">{children}</dd>
    </div>
  );
}

function ChannelCopy({ campaign: c }: { campaign: Campaign }) {
  const first = c.channels[0]?.channel;
  if (!first) return null;
  return (
    <Tabs defaultValue={first} className="mt-8 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-small font-medium text-ink">
          Post copy <span className="font-normal text-ink-muted">· {c.audience.language.toUpperCase()}</span>
        </h3>
        <TabsList aria-label="Channel" className="h-8 bg-obsidian ring-1 ring-line ring-inset">
          {c.channels.map((ch) => (
            <TabsTrigger key={ch.channel} value={ch.channel} className="px-2.5 text-meta data-active:bg-surface-raised">
              {CHANNEL_LABEL[ch.channel] ?? ch.channel}
              {!ch.withinLimit && <span className="size-1.5 rounded-full bg-status-review" aria-label="over the character limit" />}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {c.channels.map((ch) => (
        <TabsContent key={ch.channel} value={ch.channel}>
          <p className="rounded-lg bg-obsidian px-5 py-4 text-body whitespace-pre-wrap text-ink ring-1 ring-line ring-inset">{ch.copy}</p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-meta text-ink-muted">
            <span>
              {ch.format} · {ch.linkHandling}
            </span>
            <span className={cn("tabular", !ch.withinLimit && "text-status-review")}>
              {ch.characterCount}
              {ch.limit !== undefined && ` / ${ch.limit}`}
              {!ch.withinLimit && " · over the limit"}
            </span>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** The club-approved https destination for the CTA (validated server-side against the club's domains). */
function Destination({ campaign: c, busy, saving, onSetDestination }: { campaign: Campaign; busy: boolean; saving: boolean; onSetDestination: (url: string) => void }) {
  const [url, setUrl] = useState("");
  const kind = c.cta.destination?.kind === "ticketing" ? "ticketing" : "store";
  return (
    <div className="mt-8 space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-small font-medium text-ink">Destination link</h3>
        {c.cta.destination ? (
          <a
            href={c.cta.destination.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex max-w-full min-w-0 items-center gap-1 truncate text-small text-ink-soft underline decoration-line-strong underline-offset-4 hover:text-ink"
          >
            {c.cta.destination.url} <ExternalLinkIcon className="size-3 shrink-0" aria-hidden />
          </a>
        ) : (
          <span className="text-meta text-status-review">Not set — the post has no buy prompt yet</span>
        )}
      </div>
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) onSetDestination(url.trim());
        }}
      >
        <label htmlFor="cta-url" className="sr-only">
          Club {kind} link (https, on the club&apos;s own domain)
        </label>
        <Input
          id="cta-url"
          type="url"
          pattern="https://.*"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder={`https://… club ${kind} link`}
          className="h-10 bg-obsidian text-body md:text-body"
        />
        <Button type="submit" variant="outline" className="h-10 px-4" disabled={busy || !url.trim()}>
          {saving && <Loader2Icon className="animate-spin" />}
          {c.cta.destination ? "Replace link" : "Add link"}
        </Button>
      </form>
    </div>
  );
}
