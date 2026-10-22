"use client";

import { FilmIcon, LightbulbIcon, Loader2Icon, RefreshCwIcon, RouteIcon, ShieldQuestionIcon, TriangleAlertIcon } from "lucide-react";
import { DEMO_CLEARANCE_LABEL } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { when } from "../pulse-ui";
import { clock } from "../moment-ranking";
import type { AlternativeCandidate, ChannelRights, GoalView, RightsView } from "../types";
import { CHANNEL_LABEL, DemoPolicyBadge, RightsPill, TONE, VERDICT_WORD, rightsTone } from "./parts";

export type VerdictBusy = "rights" | "alternatives" | `alt:${string}` | null;

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
    <div className={cn("space-y-4 rounded-xl border p-4", tone.panel)} aria-busy={busy === "rights"}>
      {demo && <DemoPolicyBadge label={demo} className="w-full justify-center py-1.5 text-xs sm:text-sm" />}
      <div role="status" aria-live="polite" className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <tone.Icon className={cn("mt-1 size-8 shrink-0", tone.text)} aria-hidden />
          <div>
            <div className="text-[10px] font-semibold tracking-[0.18em] text-zinc-400 uppercase">Rights verdict · REROUTE</div>
            <p className={cn("font-mono text-3xl leading-tight font-black tracking-wider", tone.text)}>{VERDICT_WORD[rights.state]}</p>
            <p className="text-sm font-medium text-zinc-100">{rights.headline}</p>
          </div>
        </div>
        {rights.evaluatedAt && (
          <p className="font-mono text-[10px] text-zinc-500">
            {rights.kind === "ALTERNATIVE" ? "alternative re-checked" : "checked"} {when(rights.evaluatedAt)}
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
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-zinc-300">
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

/** One row per channel × territory: the answer a social manager needs before posting anywhere. */
function Breakdown({ rows }: { rows: ChannelRights[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-white/8 bg-black/25">
      <table className="w-full min-w-[30rem] text-left text-xs">
        <caption className="sr-only">Rights verdict per channel and territory</caption>
        <thead className="text-[10px] tracking-[0.14em] text-zinc-500 uppercase">
          <tr>
            <th scope="col" className="px-3 py-2 font-semibold">Channel</th>
            <th scope="col" className="px-3 py-2 font-semibold">Territory</th>
            <th scope="col" className="px-3 py-2 font-semibold">Verdict</th>
            <th scope="col" className="px-3 py-2 font-semibold">Why</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.channel}-${r.territory}`} className="border-t border-white/5 align-top">
              <td className="px-3 py-2 text-zinc-100">
                {CHANNEL_LABEL[r.channel] ?? r.channel}
                <span className="block text-[10px] text-zinc-500">{r.use}</span>
              </td>
              <td className="px-3 py-2 font-mono text-zinc-200">{r.territory}</td>
              <td className="px-3 py-2">
                <RightsPill state={r.verdict} clearance={r.clearance} />
              </td>
              <td className="px-3 py-2 text-zinc-300">
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
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Step 7–8: the outcome of "Find another way". CAMPAIGN-scoped blockers get a suggestion, never replacement clips. */
export function AnotherWay({
  goal,
  busy,
  disabled,
  onUse,
}: {
  goal: GoalView;
  busy: VerdictBusy;
  disabled: boolean;
  onUse: (key: string) => void;
}) {
  const alts = goal.alternatives;
  const blocker = goal.blocker ?? alts?.blocker;
  if (!alts || !blocker) return null;
  const i = alts.intent;
  return (
    <div className="space-y-3 rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-4">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold text-zinc-50">
          <RouteIcon className="size-4 text-sky-300" aria-hidden /> Another way to “{goal.run.objective.summary}”
        </h3>
        <p className="text-xs text-zinc-400">
          What blocks it: {blocker.explanation}
          {blocker.dimensions.length > 0 && <span className="text-zinc-500"> ({blocker.dimensions.join(", ")})</span>}
        </p>
      </div>

      {blocker.scope === "CAMPAIGN" ? (
        <div role="note" className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-50">
          <p className="flex items-center gap-2 font-medium">
            <LightbulbIcon className="size-4 text-amber-300" aria-hidden /> Another clip would hit the same restriction — change the use instead.
          </p>
          <p className="text-amber-100">{blocker.suggestion ?? "Change the territory, channel, usage or date of this campaign, then check rights again."}</p>
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
          <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
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
    <li className={cn("flex flex-col gap-2 rounded-lg border bg-zinc-950/70 p-3 text-xs", inUse ? "border-sky-400/60" : "border-white/10")}>
      <div className="flex gap-2.5">
        <div className="relative flex h-14 w-24 shrink-0 items-center justify-center overflow-hidden rounded bg-zinc-900">
          <FilmIcon className="size-5 text-zinc-700" aria-hidden />
          {alt.hit.thumbnailUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- TwelveLabs thumbnail reference
            <img src={alt.hit.thumbnailUrl} alt="" className="absolute inset-0 size-full object-cover" onError={(e) => (e.currentTarget.style.display = "none")} />
          )}
        </div>
        <div className="min-w-0 space-y-1">
          <p className="font-mono text-[11px] text-zinc-300">
            {clock(alt.segment.start)}–{clock(alt.segment.end)} · TwelveLabs #{alt.hit.rank}
          </p>
          <p className="truncate font-mono text-[10px] text-zinc-500" title={alt.segment.scoreplayMediaId}>
            ScorePlay {alt.segment.scoreplayMediaId}
          </p>
          <RightsPill state={alt.verdict} clearance={alt.clearance} />
        </div>
      </div>
      {alt.clearance === "DEMO" && <DemoPolicyBadge className="text-[10px]" />}
      {concerns.length > 0 ? (
        <ul className="space-y-0.5 text-[11px] text-zinc-400">
          {concerns.slice(0, 3).map((r, i) => (
            <li key={i}>
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
    </li>
  );
}
