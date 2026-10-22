"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2Icon,
  CircleDashedIcon,
  ExternalLinkIcon,
  GaugeIcon,
  Loader2Icon,
  RouteIcon,
  ShieldQuestionIcon,
  TimerIcon,
  TriangleAlertIcon,
  UnplugIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FictionalTag } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import { CopyBlock } from "../CampaignProposal";
import { clock } from "../moment-ranking";
import { when } from "../pulse-ui";
import type { GoalCampaignView, GoalView, RecommendationView, RecoveryView, RightsPresentation } from "../types";
import { MomentPreview } from "./MomentPreview";
import { displayTitle } from "./MomentCard";
import { RightsPill, StageTracker, StepHeading, TONE, rightsTone } from "./parts";

export type Busy = null | "run" | "rights" | "alternatives" | "approve" | `draft:${string}`;

type Handlers = {
  onCheckRights: () => void;
  onFindAlternatives: () => void;
  onUse: (key: string, commerceUrl?: string) => void;
  onApprove: (reviewer: string) => void;
};

const CHECK_ICON = { DONE: CheckCircle2Icon, MISSING: CircleDashedIcon, NOT_CONNECTED: UnplugIcon } as const;
const CHECK_CLASS = { DONE: "text-emerald-300", MISSING: "text-amber-300", NOT_CONNECTED: "text-zinc-400" } as const;

export function CampaignStage({
  goal,
  campaign: c,
  rec,
  busy,
  ...on
}: { goal: GoalView; campaign: GoalCampaignView; rec: RecommendationView; busy: Busy } & Handlers) {
  return (
    <section aria-labelledby="s-campaign" className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div id="s-campaign">
          <StepHeading
            n={3}
            active
            title="Campaign proposal"
            sub={
              <>
                Draft for “{c.objective.summary}” — nothing is published and no ads are bought.
              </>
            }
          />
        </div>
        <div className="space-y-1 text-right">
          <StageTracker stage={c.stage} />
          <p className="text-[11px] text-zinc-400">{c.stageNote}</p>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="space-y-4">
          <MomentPreview key={rec.key} rec={rec} />
          <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4 text-xs">
            <h3 className="text-sm font-semibold text-zinc-50">{displayTitle(c.media.title)}</h3>
            <p className="font-mono text-[11px] text-zinc-500">
              ScorePlay {c.media.scoreplayAssetId} · cut {clock(c.media.startSeconds)}–{clock(c.media.endSeconds)} (
              {(c.media.endSeconds - c.media.startSeconds).toFixed(1)} s, exact TwelveLabs timestamps)
            </p>
            <h4 className="mt-3 text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Why this media</h4>
            <ul className="mt-1 list-disc space-y-1 pl-4 text-zinc-300">
              {c.rationale.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          <KpiCard goal={goal} />
        </div>

        <div className="space-y-4">
          <RightsVerdict rights={c.rights} busy={busy} onCheck={on.onCheckRights} onFindAlternatives={on.onFindAlternatives} />
          <Creative c={c} busy={busy} onSetDestination={(url) => on.onUse(rec.key, url)} />
        </div>
      </div>

      {goal.recovery && (
        <RecoveryPanel
          recovery={goal.recovery}
          objective={goal.run.objective.summary}
          selectedKey={goal.run.selectedKey}
          current={c.rights.state}
          busy={busy}
          onUse={on.onUse}
          onMore={on.onFindAlternatives}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
        <div className="space-y-2">
          <h3 className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Channel copy · {c.audience.language.toUpperCase()}</h3>
          <div className="grid gap-2 md:grid-cols-3">
            {c.channels.map((ch) => (
              <CopyBlock key={ch.channel} channel={ch} />
            ))}
          </div>
        </div>
        <Readiness c={c} busy={busy} onApprove={on.onApprove} />
      </div>
    </section>
  );
}

function RightsVerdict({
  rights,
  busy,
  onCheck,
  onFindAlternatives,
}: {
  rights: RightsPresentation;
  busy: Busy;
  onCheck: () => void;
  onFindAlternatives: () => void;
}) {
  const tone = TONE[rightsTone(rights)];
  const stuck = rights.state === "BLOCKED" || rights.state === "NEEDS_REVIEW";
  return (
    <div role="status" aria-live="polite" className={cn("rounded-xl border p-4", tone.panel)}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <tone.Icon className={cn("mt-0.5 size-6 shrink-0", tone.text)} aria-hidden />
          <div>
            <div className="text-[10px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">Rights · decided by REROUTE</div>
            <h3 className={cn("text-lg font-semibold", tone.text)}>{rights.headline}</h3>
          </div>
        </div>
        <RightsPill rights={rights} />
      </div>
      <p className="mt-2 text-sm text-zinc-200">{rights.detail}</p>
      <p className="mt-1 text-[11px] text-zinc-400">Requested use: {rights.use}</p>
      {rights.checkedAt && (
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-zinc-500">
          policy {rights.policyId} · checked {when(rights.checkedAt)}
          {rights.policyFictional && <FictionalTag className="h-4 px-1 text-[9px]" />}
        </p>
      )}

      {rights.issues.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rights.issues.map((i) => (
            <li key={i.topic} className="rounded-md border border-white/8 bg-black/25 px-3 py-2 text-xs">
              <span className={cn("font-medium", i.outcome === "DENY" ? "text-red-200" : "text-amber-100")}>
                {i.topic}: {i.outcome === "DENY" ? "not permitted" : "not confirmed"}
              </span>
              {i.explanations.map((e) => (
                <span key={e} className="mt-0.5 block text-[11px] text-zinc-400">
                  REROUTE: “{e}”
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {rights.missingFacts.length > 0 && (
        <div className="mt-3 text-xs">
          <div className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">What REROUTE needs to decide</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-zinc-300">
            {rights.missingFacts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {rights.state === "NOT_CHECKED" ? (
          <Button size="lg" disabled={busy !== null} onClick={onCheck}>
            {busy === "rights" ? <Loader2Icon className="animate-spin" /> : <ShieldQuestionIcon />} Check rights with REROUTE
          </Button>
        ) : (
          <>
            {stuck && (
              <Button size="lg" disabled={busy !== null} onClick={onFindAlternatives}>
                {busy === "alternatives" ? <Loader2Icon className="animate-spin" /> : <RouteIcon />} Find another way
              </Button>
            )}
            <Button size="lg" variant="outline" disabled={busy !== null} onClick={onCheck}>
              {busy === "rights" ? <Loader2Icon className="animate-spin" /> : <ShieldQuestionIcon />} Re-check
            </Button>
            {rights.rerouteUrl && (
              <Button size="lg" variant="ghost" render={<Link href={rights.rerouteUrl} />} nativeButton={false}>
                <ExternalLinkIcon /> Review in REROUTE
              </Button>
            )}
          </>
        )}
      </div>
      {stuck && (
        <p className="mt-2 text-[11px] text-zinc-400">
          “Find another way” keeps your goal and asks REROUTE about the next-best moments PULSE found for it. A reviewer can also
          resolve this moment in REROUTE.
        </p>
      )}
    </div>
  );
}

function Creative({ c, busy, onSetDestination }: { c: GoalCampaignView; busy: Busy; onSetDestination: (url: string) => void }) {
  const [url, setUrl] = useState("");
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-zinc-950/60 p-4 text-xs">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Audience">
          {c.audience.market ? `${c.audience.market.label} (${c.audience.market.code})` : c.audience.scope === "GLOBAL" ? "Global" : "Not specified"} ·{" "}
          {c.audience.cohort}
        </Field>
        <Field label="Recommended channels">Instagram Reel · Facebook Reel · X video</Field>
        <Field label="Creative angle">{c.creative.angle}</Field>
        <Field label={`Hook (${c.creative.hookLanguage.toUpperCase()})`}>“{c.creative.hook}”</Field>
      </div>
      <div className="rounded-lg border border-white/8 bg-black/25 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Call to action</div>
            <div className="text-sm text-zinc-100">{c.cta.text}</div>
          </div>
          {c.cta.destination ? (
            <a href={c.cta.destination.url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 truncate text-sky-300 underline">
              {c.cta.destination.url} <ExternalLinkIcon className="size-3 shrink-0" />
            </a>
          ) : c.cta.status === "NOT_CONFIGURED" ? (
            <span className="inline-flex items-center gap-1 text-amber-300">
              <TriangleAlertIcon className="size-3.5" aria-hidden /> No destination URL yet
            </span>
          ) : null}
        </div>
        <p className="mt-1 text-[11px] text-zinc-500">{c.cta.note}</p>
        {c.cta.status !== "NOT_APPLICABLE" && (
          <form
            className="mt-2 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (url.trim()) onSetDestination(url.trim());
            }}
          >
            <Label htmlFor="g-url" className="sr-only">
              Club-approved destination URL
            </Label>
            <Input id="g-url" type="url" pattern="https://.*" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://… club-approved store link" />
            <Button type="submit" variant="outline" disabled={busy !== null || !url.trim()}>
              {c.cta.destination ? "Replace" : "Add link"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">{label}</div>
      <div className="text-zinc-200">{children}</div>
    </div>
  );
}

function Readiness({ c, busy, onApprove }: { c: GoalCampaignView; busy: Busy; onApprove: (reviewer: string) => void }) {
  const [reviewer, setReviewer] = useState("");
  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-zinc-950/60 p-4 text-xs">
      <h3 className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">Before this can go live</h3>
      <ul className="space-y-1.5">
        {c.checklist.map((item) => {
          const Icon = CHECK_ICON[item.status];
          return (
            <li key={item.item} className="flex gap-2">
              <Icon className={cn("mt-0.5 size-3.5 shrink-0", CHECK_CLASS[item.status])} aria-hidden />
              <div>
                <span className="text-zinc-100">{item.item}</span>{" "}
                <span className={cn("font-mono text-[10px]", CHECK_CLASS[item.status])}>{item.status.replace("_", " ")}</span>
                <p className="text-[11px] text-zinc-500">{item.note}</p>
              </div>
            </li>
          );
        })}
      </ul>
      {c.stage === "APPROVED" ? (
        <p className="text-emerald-300">Approved by {c.approval?.by}. Publish it from the club&apos;s own tools.</p>
      ) : (
        <form
          className="flex gap-2 border-t border-white/5 pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            onApprove(reviewer);
          }}
        >
          <Input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="Approver name" aria-label="Approver name" maxLength={80} />
          <Button type="submit" disabled={busy !== null || c.stage !== "READY_FOR_APPROVAL" || !reviewer.trim()}>
            {busy === "approve" ? <Loader2Icon className="animate-spin" /> : <CheckCircle2Icon />} Approve
          </Button>
        </form>
      )}
      <details className="text-[11px] text-zinc-500">
        <summary className="cursor-pointer hover:text-zinc-300">What PULSE did not do</summary>
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {c.safeguards.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>
    </div>
  );
}

function KpiCard({ goal }: { goal: GoalView }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
          <GaugeIcon className="size-3.5" aria-hidden /> Primary KPI
        </div>
        <div className="mt-1 text-sm font-medium text-zinc-100">{goal.kpi.label}</div>
        <div className="mt-1 font-mono text-2xl text-zinc-500">—</div>
        <p className="text-[11px] text-zinc-500">{goal.kpi.note}</p>
      </div>
      <div className="rounded-xl border border-white/10 bg-zinc-950/60 p-4">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">
          <TimerIcon className="size-3.5" aria-hidden /> Measured workflow time
        </div>
        <div className="mt-1 font-mono text-2xl text-zinc-50">{goal.timing.toCampaignSec !== undefined ? duration(goal.timing.toCampaignSec) : "—"}</div>
        <p className="text-[11px] text-zinc-500">
          Goal submitted → campaign proposal, including your review time. Recommendations took {duration(goal.timing.toRecommendationsSec)}. No baseline
          is assumed, so no time saving is claimed.
        </p>
      </div>
    </div>
  );
}

function duration(sec: number): string {
  return sec < 90 ? `${sec.toFixed(1)} s` : `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
}

const GROUPS = [
  { key: "ALLOWED", title: "Allowed by REROUTE", empty: "None yet." },
  { key: "NEEDS_REVIEW", title: "Needs review", empty: "None." },
  { key: "BLOCKED", title: "Blocked", empty: "None." },
  { key: "UNCHECKED", title: "Not checked yet", empty: "No more moments from this search." },
] as const;

function RecoveryPanel({
  recovery: r,
  objective,
  selectedKey,
  current,
  busy,
  onUse,
  onMore,
}: {
  recovery: RecoveryView;
  objective: string;
  selectedKey?: string;
  current: RightsPresentation["state"];
  busy: Busy;
  onUse: (key: string) => void;
  onMore: () => void;
}) {
  return (
    <section aria-labelledby="s-recovery" className="space-y-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 id="s-recovery" className="flex items-center gap-2 text-base font-semibold text-zinc-50">
            <RouteIcon className="size-4 text-sky-300" aria-hidden /> Another way to the same goal
          </h3>
          <p className="text-xs text-zinc-400">
            Still working toward “{objective}”. PULSE took the next-best moments it found for this goal and REROUTE
            evaluated each one independently, for the same use.
          </p>
        </div>
        {!r.exhausted && (current === "BLOCKED" || current === "NEEDS_REVIEW") && (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={onMore}>
            {busy === "alternatives" ? <Loader2Icon className="animate-spin" /> : <RouteIcon />} Ask REROUTE about more moments
          </Button>
        )}
      </div>
      {r.sharedBlocker && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          {r.sharedBlocker}
        </p>
      )}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {GROUPS.map((g) => (
          <div key={g.key} className="space-y-2">
            <h4 className="flex items-center justify-between text-[10px] font-semibold tracking-[0.16em] text-zinc-400 uppercase">
              {g.title} <span className="font-mono text-zinc-500">{r.groups[g.key].length}</span>
            </h4>
            {r.groups[g.key].length === 0 && <p className="text-[11px] text-zinc-600">{g.empty}</p>}
            {r.groups[g.key].map((alt) => (
              <AltCard key={alt.key} alt={alt} inUse={alt.key === selectedKey} busy={busy} onUse={() => onUse(alt.key)} />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

function AltCard({ alt, inUse, busy, onUse }: { alt: RecommendationView; inUse: boolean; busy: Busy; onUse: () => void }) {
  const c = alt.candidate;
  return (
    <div className={cn("space-y-1.5 rounded-lg border bg-zinc-950/70 p-2.5 text-xs", inUse ? "border-sky-400/60" : "border-white/10")}>
      <div className="flex gap-2">
        {c.thumbnailUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- ScorePlay/TwelveLabs thumbnail reference
          <img src={c.thumbnailUrl} alt="" className="h-12 w-20 shrink-0 rounded object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
        )}
        <div className="min-w-0">
          <p className="truncate font-medium text-zinc-100" title={c.title}>
            {displayTitle(c.title)}
          </p>
          <p className="font-mono text-[10px] text-zinc-500">
            {clock(c.startSeconds ?? 0)}–{clock(c.endSeconds ?? 0)} · {alt.matches.map((m) => m.label).join(", ")}
          </p>
        </div>
      </div>
      <RightsPill rights={alt.rights} />
      {alt.rights.state !== "NOT_CHECKED" && (
        <p className="text-[11px] text-zinc-400">
          {alt.rights.headline}
          {alt.rights.issues[0] && ` — ${alt.rights.issues.map((i) => i.topic.toLowerCase()).join(", ")}`}
        </p>
      )}
      <Button size="xs" variant={inUse ? "ghost" : "outline"} className="w-full" disabled={busy !== null || inUse || alt.rights.state === "BLOCKED"} onClick={onUse}>
        {busy === `draft:${alt.key}` && <Loader2Icon className="animate-spin" />}
        {inUse ? "In your campaign" : alt.rights.state === "BLOCKED" ? "Blocked by REROUTE" : "Use this instead"}
      </Button>
    </div>
  );
}
