"use client";

import { LightbulbIcon, Loader2Icon, RefreshCwIcon, RouteIcon, ShieldQuestionIcon, TriangleAlertIcon, WandSparklesIcon } from "lucide-react";
import { DEMO_CLEARANCE_LABEL } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { utc } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import { clock } from "../moment-ranking";
import type { AlternativeCandidate, ChannelRights, GoalView, RightsView } from "../types";
import { displayTitle } from "./MomentCard";
import { MomentPreview } from "./MomentPreview";
import { CHANNEL_LABEL, DemoPolicyBadge, RightsPill, TONE, VERDICT_WORD, rightsTone } from "./parts";

export type VerdictBusy = "rights" | "alternatives" | "remedy" | `alt:${string}` | null;

/** The label every demo-policy verdict must carry, or null for verified policies. */
export function demoLabel(rights: RightsView): string | null {
  if (rights.clearanceLabel) return rights.clearanceLabel;
  return rights.perIntent.some((p) => p.policyFictional) ? DEMO_CLEARANCE_LABEL : null;
}

/** Step 5–6: REROUTE's verdict, readable at a glance, with the per-channel × territory breakdown. */
export function VerdictPanel({
  rights,
  busy,
  disabled,
  onCheck,
  onFindAnotherWay,
}: {
  rights: RightsView;
  busy: VerdictBusy;
  disabled: boolean;
  onCheck: () => void;
  onFindAnotherWay: () => void;
}) {
  const checked = rights.state !== "NOT_CHECKED";
  const tone = TONE[rightsTone(rights.state, rights.clearance)];
  const restricted = rights.current && (rights.state === "BLOCKED" || rights.state === "NEEDS_REVIEW");
  const demo = checked ? demoLabel(rights) : null;

  if (!checked) {
    return (
      <div className="flex flex-col items-start gap-3 rounded-xl border border-white/10 bg-zinc-950/60 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-zinc-300">
          <p className="font-medium text-zinc-100">Not checked yet</p>
          <p className="text-xs text-zinc-400">REROUTE checks every channel × territory in this proposal separately. PULSE never decides rights.</p>
        </div>
        <Button size="lg" disabled={disabled} onClick={onCheck}>
          {busy === "rights" ? <Loader2Icon className="animate-spin" /> : <ShieldQuestionIcon />} Check rights
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("min-w-0 space-y-4 rounded-xl border p-4", tone.panel)} aria-busy={busy === "rights"}>
      {demo && <DemoPolicyBadge label={demo} className="w-full justify-center py-1.5 text-xs sm:text-sm" />}
      <div role="status" aria-live="polite" className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <tone.Icon className={cn("mt-1 size-8 shrink-0", tone.text)} aria-hidden />
          <div className="min-w-0">
            <div className="text-[10px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">Rights verdict · REROUTE</div>
            <p className={cn("font-mono text-2xl leading-tight font-black tracking-wider sm:text-3xl", tone.text)}>{VERDICT_WORD[rights.state]}</p>
            <p className="text-sm font-medium text-zinc-100">{rights.headline}</p>
          </div>
        </div>
        {rights.evaluatedAt && (
          <p className="font-mono text-[10px] text-zinc-500">
            {rights.kind === "ALTERNATIVE" ? "alternative re-checked" : "checked"} {utc(rights.evaluatedAt)}
          </p>
        )}
      </div>
      <p className="text-sm text-zinc-200">{rights.detail}</p>

      {!rights.current && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-sky-500/40 bg-sky-500/10 px-3 py-2 text-xs text-sky-100">
          <RefreshCwIcon className="mt-0.5 size-3.5 shrink-0" aria-hidden /> The campaign changed after this check. Check rights again before submitting.
        </p>
      )}

      {rights.perIntent.length > 0 && <Breakdown rows={rights.perIntent} />}

      {rights.missingFacts.length > 0 && (
        <div className="text-xs">
          <div className="text-[10px] font-semibold tracking-[0.16em] text-zinc-500 uppercase">What REROUTE still needs</div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 break-words text-zinc-300">
            {rights.missingFacts.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!rights.current ? (
          <Button size="lg" disabled={disabled} onClick={onCheck}>
            {busy === "rights" ? <Loader2Icon className="animate-spin" /> : <ShieldQuestionIcon />} Check rights again
          </Button>
        ) : (
          <>
            {restricted && (
              <Button size="lg" disabled={disabled} onClick={onFindAnotherWay}>
                {busy === "alternatives" ? <Loader2Icon className="animate-spin" /> : <RouteIcon />} Find another way
              </Button>
            )}
            <Button size="lg" variant="outline" disabled={disabled} onClick={onCheck}>
              {busy === "rights" ? <Loader2Icon className="animate-spin" /> : <RefreshCwIcon />} Check again
            </Button>
          </>
        )}
      </div>
      {restricted && (
        <p className="text-[11px] text-zinc-400">
          “Find another way” keeps your goal: REROUTE works out whether the clip or the use is the problem, then searches for replacements and re-checks each one
          independently.
        </p>
      )}
    </div>
  );
}

/** One row per channel × territory: the answer a social manager needs before posting anywhere. Stacks on phones. */
function Breakdown({ rows }: { rows: ChannelRights[] }) {
  const cols = "sm:grid-cols-[minmax(6rem,8rem)_4.5rem_minmax(8rem,10rem)_minmax(0,1fr)]";
  return (
    <div role="table" aria-label="Rights verdict per channel and territory" className="rounded-lg border border-white/8 bg-black/25 text-xs">
      <div role="row" className={cn("hidden gap-3 px-3 py-2 text-[10px] font-semibold tracking-[0.14em] text-zinc-500 uppercase sm:grid", cols)}>
        <span role="columnheader">Channel</span>
        <span role="columnheader">Territory</span>
        <span role="columnheader">Verdict</span>
        <span role="columnheader">Why</span>
      </div>
      {rows.map((r) => (
        <div role="row" key={`${r.channel}-${r.territory}`} className={cn("grid grid-cols-[minmax(0,1fr)] gap-1.5 border-t border-white/5 px-3 py-2 first-of-type:border-t-0 sm:gap-3", cols)}>
          <div role="cell" className="text-zinc-100">
            {CHANNEL_LABEL[r.channel] ?? r.channel}
            <span className="font-mono text-zinc-300 sm:hidden"> · {r.territory}</span>
            <span className="block text-[10px] text-zinc-500">{r.use}</span>
          </div>
          <div role="cell" className="hidden font-mono text-zinc-200 sm:block">
            {r.territory}
          </div>
          <div role="cell">
            <RightsPill state={r.verdict} clearance={r.clearance} />
          </div>
          <div role="cell" className="min-w-0 break-words text-zinc-300">
            {r.issues.length === 0 ? (
              <span className="text-zinc-500">{r.verdict === "ALLOWED" ? "Every rights dimension permitted." : "—"}</span>
            ) : (
              <ul className="space-y-1">
                {r.issues.map((i) => (
                  <li key={i.topic}>
                    <span className={cn("font-medium", i.outcome === "DENY" ? "text-red-200" : "text-amber-100")}>
                      {i.topic}: {i.outcome === "DENY" ? "not permitted" : "not confirmed"}
                    </span>
                    <span className="block text-[11px] text-zinc-400">{i.explanations[0]}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Step 7–8: the outcome of "Find another way" for the LATEST evaluation only. CAMPAIGN-scoped blockers get
 * REROUTE's one-click remedy (restrict the campaign to its licensed uses), never replacement clips.
 */
export function AnotherWay({
  goal,
  busy,
  disabled,
  onUse,
  onApplyRemedy,
}: {
  goal: GoalView;
  busy: VerdictBusy;
  disabled: boolean;
  onUse: (key: string) => void;
  onApplyRemedy: () => void;
}) {
  const alts = goal.alternatives;
  // A search made for an older evaluation (e.g. before an alternative was adopted) is history, not a next step.
  if (!alts || alts.forEvaluationId !== goal.rights.evaluationId || !goal.rights.current) return null;
  const blocker = goal.blocker ?? alts.blocker;
  const i = alts.intent;
  return (
    <div className="min-w-0 space-y-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-4">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-50">
          <RouteIcon className="size-4 shrink-0 text-sky-300" aria-hidden /> Another way to “{goal.run.objective.summary}”
        </h3>
        <p className="text-xs break-words text-zinc-400">
          What blocks it: {blocker.explanation}
          {blocker.dimensions.length > 0 && <span className="text-zinc-500"> ({blocker.dimensions.join(", ")})</span>}
        </p>
      </div>

      {blocker.scope === "CAMPAIGN" ? (
        <div role="note" className="space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-50">
          <p className="flex items-center gap-2 font-medium">
            <LightbulbIcon className="size-4 shrink-0 text-amber-300" aria-hidden /> Another clip would hit the same restriction — change the use instead.
          </p>
          {goal.remedy ? (
            <>
              <p className="text-amber-100">{goal.remedy.description}</p>
              <Button className="h-auto min-h-8 whitespace-normal" disabled={disabled} onClick={onApplyRemedy}>
                {busy === "remedy" ? <Loader2Icon className="animate-spin" /> : <WandSparklesIcon />} {goal.remedy.label}
              </Button>
              <p className="text-[11px] text-amber-200/80">This saves a new campaign version; REROUTE then checks it again from scratch.</p>
            </>
          ) : (
            <p className="text-amber-100">{blocker.suggestion ?? "Change the territory, channel, usage or date of this campaign, then check rights again."}</p>
          )}
        </div>
      ) : blocker.scope === "NONE" ? (
        <p className="text-xs text-zinc-400">Nothing to route around for this campaign.</p>
      ) : alts.candidates.length === 0 ? (
        <p className="flex items-start gap-2 rounded-lg border border-white/10 bg-zinc-950/60 p-3 text-xs text-zinc-300">
          <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-300" aria-hidden />
          REROUTE searched the library for “{alts.query}” but found no replacement moment. PULSE never fills the gap with invented clips.
          {blocker.suggestion && ` ${blocker.suggestion}`}
        </p>
      ) : (
        <>
          <p className="text-[11px] text-zinc-400">
            Each replacement was searched in TwelveLabs for “{alts.query}” and independently re-checked by REROUTE for {CHANNEL_LABEL[i.platform] ?? i.platform} · {i.territory} ·{" "}
            {i.usage.toLowerCase()}.
          </p>
          <ul className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-3">
            {alts.candidates.map((c) => (
              <AltCard key={c.key} alt={c} inUse={goal.campaign?.key === c.key} loading={busy === `alt:${c.key}`} disabled={disabled} onUse={() => onUse(c.key)} />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function AltCard({ alt, inUse, loading, disabled, onUse }: { alt: AlternativeCandidate; inUse: boolean; loading: boolean; disabled: boolean; onUse: () => void }) {
  const concerns = alt.reasons.filter((r) => r.outcome !== "PERMIT");
  return (
    <li className={cn("flex min-w-0 flex-col overflow-hidden rounded-lg border bg-zinc-950/70 text-xs", inUse ? "border-sky-400/60" : "border-white/10")}>
      <MomentPreview
        key={alt.key}
        className="rounded-none border-0 border-b border-white/10"
        source={{
          title: alt.title,
          scoreplayAssetId: alt.segment.scoreplayMediaId,
          thumbnailUrl: alt.thumbnailUrl ?? alt.hit.thumbnailUrl,
          start: alt.segment.start,
          end: alt.segment.end,
          preview: alt.preview,
          note: "No playable stream for this replacement — thumbnail and timecode come from TwelveLabs.",
        }}
      />
      <div className="flex flex-1 flex-col gap-2 p-3">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-sm font-medium text-zinc-100" title={alt.title}>
            {displayTitle(alt.title)}
          </p>
          <p className="font-mono text-[11px] text-zinc-400">
            {clock(alt.segment.start)}–{clock(alt.segment.end)} · TwelveLabs #{alt.hit.rank}
          </p>
          <RightsPill state={alt.verdict} clearance={alt.clearance} />
        </div>
        {alt.clearance === "DEMO" && <DemoPolicyBadge className="text-[10px]" />}
        {concerns.length > 0 ? (
          <ul className="space-y-0.5 text-[11px] break-words text-zinc-400">
            {concerns.slice(0, 3).map((r, n) => (
              <li key={n}>
                <span className={r.outcome === "DENY" ? "text-red-200" : "text-amber-100"}>{r.dimension}</span>: {r.explanation}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] text-zinc-400">No restriction found for this use.</p>
        )}
        <Button size="sm" variant={inUse ? "ghost" : "outline"} className="mt-auto w-full" disabled={disabled || inUse || alt.verdict === "BLOCKED"} onClick={onUse}>
          {loading && <Loader2Icon className="animate-spin" />}
          {inUse ? "In your campaign" : alt.verdict === "BLOCKED" ? "Blocked by REROUTE" : "Use this instead"}
        </Button>
      </div>
    </li>
  );
}
