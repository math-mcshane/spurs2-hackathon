"use client";

import { useId, useState } from "react";
import {
  ArrowLeftRightIcon,
  ArrowRightIcon,
  BanIcon,
  CheckIcon,
  ChevronRightIcon,
  ClapperboardIcon,
  CropIcon,
  Loader2Icon,
  MailIcon,
  MapIcon,
  MegaphoneIcon,
  ReplaceIcon,
  ScissorsIcon,
  SendIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import { Reveal, Swap } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { utc } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import type { BeforeAfter, EditTimeline, GoalView, RecoveryKind, RecoveryOption, RecoveryView } from "../types";
import { CHANNEL_LABEL, Eyebrow, StagedProgress, StatusPill, country, displayTitle, rightsStatus, usageWord, type Stage, type Status } from "./parts";

// ---------- Time ----------

/** Source seconds → `m:ss.s` (tenths: a cut is decided to the tenth, not the second). */
export function tc(sec: number): string {
  const t = Math.round(Math.max(0, sec) * 10) / 10;
  const m = Math.floor(t / 60);
  return `${m}:${(t - m * 60).toFixed(1).padStart(4, "0")}`;
}

const secs = (sec: number) => `${sec.toFixed(1)} s`;
const spanText = (s: { start: number; end: number }) => `${tc(s.start)}–${tc(s.end)}`;

/** Hatched fill for footage the rules don't allow (pattern + border + label: never colour alone). */
const HATCH: React.CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, color-mix(in oklab, var(--color-status-blocked) 55%, transparent) 0 2px, transparent 2px 6px)",
};

// ---------- Labels ----------

const KIND: Record<RecoveryKind, { label: string; Icon: typeof ScissorsIcon }> = {
  TRIM: { label: "Cut the restricted seconds", Icon: ScissorsIcon },
  SAFE_SECTION: { label: "Use only the clean section", Icon: CropIcon },
  REPLACE: { label: "Use another moment", Icon: ReplaceIcon },
  ADAPT_CAMPAIGN: { label: "Adjust the campaign", Icon: MapIcon },
  CHANGE_USAGE: { label: "Change the type of post", Icon: MegaphoneIcon },
  REQUEST_CLEARANCE: { label: "Ask for clearance", Icon: MailIcon },
};

/** The demo-policy line every RESOLVES_DEMO re-check carries. */
const DEMO_ALLOWED = "Allowed under the demo policy — not legal clearance";

function verdictWords(status: Status): string {
  return status === "provisional"
    ? "Allowed under the demo policy"
    : status === "clear"
      ? "Cleared"
      : status === "blocked"
        ? "Blocked"
        : status === "review"
          ? "Needs review"
          : "Not checked";
}

// ---------- Timelines ----------

/**
 * The selected range of the original moment, one lane per timed finding (findings may overlap, e.g. two
 * analyses of the same crest). Each mark is numbered (the legend below repeats it as text) and hatched, so the
 * restriction never depends on colour alone.
 */
function RangeTrack({ span, marks, className }: { span: { start: number; end: number }; marks: { n: number; start: number; end: number }[]; className?: string }) {
  const total = Math.max(0.001, span.end - span.start);
  const pct = (x: number) => Math.min(100, Math.max(0, ((x - span.start) / total) * 100));
  const ticks = Array.from({ length: Math.floor(span.end) - Math.ceil(span.start) + 1 }, (_, i) => Math.ceil(span.start) + i);
  return (
    <div className={className} aria-hidden>
      <div className="relative flex flex-col gap-1 rounded-md bg-surface-raised p-1 ring-1 ring-line ring-inset">
        <div className="absolute inset-1">
          {ticks.map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-line" style={{ left: `${pct(t)}%` }} />
          ))}
        </div>
        {(marks.length > 0 ? marks : [null]).map((m, i) => {
          if (!m) return <div key={i} className="h-4" />;
          const left = pct(m.start);
          const width = Math.max(0.8, pct(m.end) - left);
          const inside = width > 8;
          return (
            <div key={m.n} className="relative h-4">
              <span className="absolute inset-y-0 rounded-[2px] border-x border-status-blocked/80 bg-status-blocked/10" style={{ ...HATCH, left: `${left}%`, width: `${width}%` }} />
              <span
                className="tabular absolute top-0 rounded-sm bg-obsidian/85 px-1 font-mono text-[0.6875rem] leading-4 text-status-blocked"
                style={inside ? { left: `calc(${left}% + 3px)` } : { left: `calc(${left + width}% + 4px)` }}
              >
                {m.n}
              </span>
            </div>
          );
        })}
      </div>
      <div className="tabular mt-1.5 flex justify-between font-mono text-meta text-ink-muted">
        <span>{tc(span.start)}</span>
        <span>{tc(span.end)}</span>
      </div>
    </div>
  );
}

/** "Edit plan — not rendered": always visible next to any cut, so a plan never reads as a finished file. */
function ExecutionTag({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-dashed border-line-strong px-2 py-0.5 text-meta text-ink-soft">
      <ClapperboardIcon className="size-3.5 shrink-0 text-ink-muted" aria-hidden />
      {label}
    </span>
  );
}

/**
 * Before/after of a derived cut. BEFORE: the original span with removed source intervals hatched (with why)
 * and retained ones solid. AFTER: the retained pieces end to end, drawn on the same scale so the shorter result
 * is visible. Screen readers get the whole plan as one sentence.
 */
export function EditTimelineView({ timeline: t, compact = false, className }: { timeline: EditTimeline; compact?: boolean; className?: string }) {
  const total = Math.max(0.001, t.original.end - t.original.start);
  const pct = (x: number) => Math.min(100, Math.max(0, ((x - t.original.start) / total) * 100));
  const width = (a: number, b: number) => Math.max(0.6, ((b - a) / total) * 100);
  const describe = [
    `Edit plan for ${displayTitle(t.sourceTitle)}: original ${spanText(t.original)}, ${secs(t.originalDurationSec)}.`,
    t.removed.length > 0 && `Removed: ${t.removed.map((r) => `${spanText(r)} (${r.why})`).join("; ")}.`,
    t.retained.length > 0 ? `Kept: ${t.retained.map(spanText).join(", ")}.` : "Nothing kept.",
    `Result ${secs(t.resultDurationSec)} of ${secs(t.originalDurationSec)}. ${t.executionLabel}.`,
  ]
    .filter(Boolean)
    .join(" ");
  const bar = compact ? "h-3" : "h-7";
  const row = "grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-3";
  return (
    <figure className={cn("space-y-2", className)}>
      <figcaption className="sr-only">{describe}</figcaption>
      <div aria-hidden className="space-y-2">
        <div className={row}>
          <span className="text-meta text-ink-muted">Before</span>
          <div className={cn("relative overflow-hidden rounded-sm bg-surface-raised ring-1 ring-line ring-inset", bar)}>
            {t.retained.map((r, i) => (
              <span key={`k${i}`} className="absolute inset-y-0 bg-ink/75" style={{ left: `${pct(r.start)}%`, width: `${width(r.start, r.end)}%` }} />
            ))}
            {t.removed.map((r, i) => (
              <span
                key={`r${i}`}
                className="absolute inset-y-0 border-x border-status-blocked/80"
                style={{ ...HATCH, left: `${pct(r.start)}%`, width: `${width(r.start, r.end)}%` }}
              >
                {!compact && <ScissorsIcon className="absolute top-1/2 left-1 size-3 -translate-y-1/2 text-status-blocked" />}
              </span>
            ))}
          </div>
        </div>
        <div className={row}>
          <span className="text-meta text-ink-muted">After</span>
          <div className={cn("relative flex", bar)}>
            {t.output.length === 0 ? (
              <span className="text-meta text-ink-muted">Nothing left</span>
            ) : (
              t.output.map((o, i) => (
                <span
                  key={i}
                  className={cn("h-full bg-ink/75 first:rounded-l-sm last:rounded-r-sm", i > 0 && "border-l-2 border-obsidian")}
                  style={{ width: `${width(o.outStart, o.outEnd)}%` }}
                  title={`${spanText({ start: o.sourceStart, end: o.sourceEnd })} of the source`}
                />
              ))
            )}
          </div>
        </div>
        {!compact && (
          <div className={row}>
            <span />
            <div className="tabular flex justify-between font-mono text-meta text-ink-muted">
              <span>{tc(t.original.start)}</span>
              <span>{tc(t.original.end)}</span>
            </div>
          </div>
        )}
      </div>
      {!compact && t.removed.length > 0 && (
        <ul className="space-y-1 text-meta text-ink-soft">
          {t.removed.map((r, i) => (
            <li key={i} className="flex gap-2">
              <ScissorsIcon className="mt-0.5 size-3 shrink-0 text-status-blocked" aria-hidden />
              <span>
                <span className="tabular font-mono text-ink">Remove {spanText(r)}</span> — {r.why}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="tabular text-meta text-ink-soft">
          Result <span className="font-medium text-ink">{secs(t.resultDurationSec)}</span> of {secs(t.originalDurationSec)}
        </p>
        <ExecutionTag label={t.executionLabel} />
      </div>
    </figure>
  );
}

// ---------- Re-check ----------

function RecheckBlock({ option, progress }: { option: RecoveryOption; progress?: { stages: Stage[]; note?: string } }) {
  if (progress)
    return (
      <div className="rounded-lg bg-obsidian px-4 py-3 ring-1 ring-line ring-inset">
        <StagedProgress stages={progress.stages} note={progress.note} />
      </div>
    );
  const rc = option.recheck;
  if (!rc) return null;
  const status = rightsStatus(rc.verdict, rc.clearance);
  return (
    <div className="space-y-2.5 rounded-lg bg-obsidian px-4 py-3.5 ring-1 ring-line ring-inset">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <Eyebrow>Independent re-check</Eyebrow>
        <StatusPill status={status} />
      </div>
      <p className="text-small text-ink">
        <span className="tabular font-medium">
          {rc.allowedUses} of {rc.totalUses}
        </span>{" "}
        uses allowed after this change
      </p>
      {option.outcome === "RESOLVES_DEMO" && (
        <p role="note" className="flex items-start gap-2 rounded-md border border-dashed border-status-review/45 px-3 py-2 text-meta text-ink-soft">
          <TriangleAlertIcon className="mt-px size-3.5 shrink-0 text-status-review" aria-hidden />
          {DEMO_ALLOWED}
        </p>
      )}
      {rc.remaining.length > 0 && (
        <ul className="space-y-1.5 text-small">
          {rc.remaining.map((x, i) => (
            <li key={i} className="flex gap-2">
              <XIcon className="mt-1 size-3 shrink-0 text-status-blocked" aria-hidden />
              <span className="text-ink-soft">
                {x.text}
                {x.at && <span className="tabular text-ink-muted"> · {spanText(x.at)}</span>}
                <span className="block text-meta text-ink-muted">{x.source}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------- Option details ----------

function MarketsChange({ option, plan }: { option: RecoveryOption; plan: GoalView["run"]["plan"] }) {
  const ch = option.campaignChange;
  if (!ch) return null;
  const kept = ch.territories ?? plan.territories.filter((t) => !ch.dropped?.includes(t));
  const markets = [...new Set([...plan.territories, ...(ch.territories ?? []), ...(ch.dropped ?? [])])];
  return (
    <div className="space-y-2">
      {(ch.territories || ch.dropped) && (
        <ul className="flex flex-wrap gap-1.5" aria-label="Markets">
          {markets.map((t) => {
            const keep = kept.includes(t);
            return (
              <li
                key={t}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-meta ring-1 ring-inset",
                  keep ? "text-ink ring-line-strong" : "text-ink-muted line-through decoration-ink-muted/60 ring-line",
                )}
              >
                {keep ? <CheckIcon className="size-3" aria-hidden /> : <XIcon className="size-3" aria-hidden />}
                <span>{country(t)}</span>
                <span className="sr-only">{keep ? "(kept)" : "(dropped)"}</span>
              </li>
            );
          })}
        </ul>
      )}
      {(ch.platforms || ch.usage) && (
        <p className="text-meta text-ink-soft">
          {ch.platforms && `Channels: ${ch.platforms.map((p) => CHANNEL_LABEL[p] ?? p).join(", ")}`}
          {ch.platforms && ch.usage && " · "}
          {ch.usage && (
            <>
              {usageWord(plan.usage)} → <span className="text-ink">{usageWord(ch.usage)} post</span>
            </>
          )}
        </p>
      )}
    </div>
  );
}

function ReplacementLine({ option }: { option: RecoveryOption }) {
  const r = option.replacement;
  if (!r) return null;
  return (
    <div className="flex items-start gap-3 rounded-lg px-3 py-2.5 ring-1 ring-line ring-inset">
      <span className="tabular shrink-0 rounded bg-surface-raised px-1.5 py-1 font-mono text-meta text-ink">{spanText(r)}</span>
      <div className="min-w-0">
        <p className="truncate text-small font-medium text-ink" title={r.title}>
          {displayTitle(r.title)}
        </p>
        <p className="text-meta text-ink-muted">
          Search rank {r.rank} for “{r.query}”
        </p>
      </div>
    </div>
  );
}

function GoalChange({ option }: { option: RecoveryOption }) {
  if (!option.changesGoal) return null;
  return (
    <p className="flex items-start gap-1.5 text-meta text-status-review">
      <TriangleAlertIcon className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        {/^changes the goal/i.test(option.tradeoff) ? option.tradeoff : `Changes the goal: ${option.tradeoff.charAt(0).toLowerCase()}${option.tradeoff.slice(1)}`}
      </span>
    </p>
  );
}

/**
 * A clean section of the same asset: where it sits against the moment that was chosen, on the asset's own
 * timeline (the section replaces the moment; nothing is cut out of it).
 */
function SectionTrack({ timeline: t, chosen, compact = false, className }: { timeline: EditTimeline; chosen: { start: number; end: number }; compact?: boolean; className?: string }) {
  const from = t.assetDurationSec ? 0 : Math.min(chosen.start, t.original.start);
  const to = t.assetDurationSec ?? Math.max(chosen.end, t.original.end);
  const pct = (x: number) => ((x - from) / Math.max(0.001, to - from)) * 100;
  const row = "grid grid-cols-[3.25rem_minmax(0,1fr)] items-center gap-3";
  const bar = compact ? "h-3" : "h-6";
  return (
    <figure className={cn("space-y-2", className)}>
      <figcaption className="sr-only">
        {`Clean section ${spanText(t.original)} of ${displayTitle(t.sourceTitle)} instead of the chosen moment ${spanText(chosen)}. Result ${secs(t.resultDurationSec)}. ${t.executionLabel}.`}
      </figcaption>
      <div aria-hidden className="space-y-2">
        <div className={row}>
          <span className="text-meta text-ink-muted">Chosen</span>
          <div className={cn("relative rounded-sm bg-surface-raised ring-1 ring-line ring-inset", bar)}>
            <span className="absolute inset-y-0 border-x border-status-blocked/80" style={{ ...HATCH, left: `${pct(chosen.start)}%`, width: `${pct(chosen.end) - pct(chosen.start)}%` }} />
          </div>
        </div>
        <div className={row}>
          <span className="text-meta text-ink-muted">Clean</span>
          <div className={cn("relative rounded-sm bg-surface-raised ring-1 ring-line ring-inset", bar)}>
            <span className="absolute inset-y-0 rounded-sm bg-ink/75" style={{ left: `${pct(t.original.start)}%`, width: `${pct(t.original.end) - pct(t.original.start)}%` }} />
          </div>
        </div>
        {!compact && (
          <div className={row}>
            <span />
            <div className="tabular flex justify-between font-mono text-meta text-ink-muted">
              <span>{tc(from)}</span>
              <span>{tc(to)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <p className="tabular text-meta text-ink-soft">
          Uses <span className="font-medium text-ink">{spanText(t.original)}</span> · {secs(t.resultDurationSec)}
        </p>
        <ExecutionTag label={t.executionLabel} />
      </div>
    </figure>
  );
}

/** A cut shows before/after; a clean section (nothing removed) shows where it sits against the chosen moment. */
export function EditPlanView({ timeline, chosen, compact = false, className }: { timeline: EditTimeline; chosen?: { start: number; end: number }; compact?: boolean; className?: string }) {
  return timeline.removed.length === 0 && chosen ? (
    <SectionTrack timeline={timeline} chosen={chosen} compact={compact} className={className} />
  ) : (
    <EditTimelineView timeline={timeline} compact={compact} className={className} />
  );
}

/** The ranked moment a campaign version was built on (by key), as a source range. */
export function momentSpan(goal: GoalView, key: string): { start: number; end: number } | undefined {
  const c = goal.recommendations.find((r) => r.key === key)?.candidate;
  return c?.endSeconds === undefined ? undefined : { start: c.startSeconds ?? 0, end: c.endSeconds };
}

/** The chosen correction, large: what changes, the cut (if any), the trade-off and the independent re-check. */
function FeaturedOption({
  option,
  plan,
  chosen,
  progress,
}: {
  option: RecoveryOption;
  plan: GoalView["run"]["plan"];
  chosen?: { start: number; end: number };
  progress?: { stages: Stage[]; note?: string };
}) {
  const k = KIND[option.kind];
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface-raised text-ink ring-1 ring-line-strong" aria-hidden>
          <k.Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="text-meta text-ink-muted">{k.label}</p>
          <h4 className="font-display text-[1.25rem] leading-tight font-medium text-ink">{option.title}</h4>
        </div>
      </div>
      <p className="text-small text-ink-soft">{option.summary}</p>
      {option.timeline && <EditPlanView timeline={option.timeline} chosen={chosen} />}
      <ReplacementLine option={option} />
      <MarketsChange option={option} plan={plan} />
      {option.changesGoal ? (
        <GoalChange option={option} />
      ) : (
        <p className="text-meta text-ink-muted">
          Trade-off: <span className="text-ink-soft">{option.tradeoff}</span>
        </p>
      )}
      <RecheckBlock option={option} progress={progress} />
    </div>
  );
}

/** A compact row for every other option: workable ones can be selected, rejected ones say why. */
function OptionRow({
  option,
  plan,
  chosen,
  selectable,
  disabled,
  onSelect,
}: {
  option: RecoveryOption;
  plan: GoalView["run"]["plan"];
  chosen?: { start: number; end: number };
  selectable: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const k = KIND[option.kind];
  const rejected = option.outcome === "NOT_VIABLE";
  const next = option.outcome === "NEXT_STEP";
  const status = option.recheck ? rightsStatus(option.recheck.verdict, option.recheck.clearance) : null;
  return (
    <div className="flex gap-3 py-4">
      <k.Icon className={cn("mt-0.5 size-4 shrink-0", rejected ? "text-ink-muted" : "text-ink-soft")} aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className={cn("text-small font-medium", rejected ? "text-ink-soft" : "text-ink")}>{option.title}</p>
          {rejected ? (
            <span className="inline-flex items-center gap-1 text-meta text-ink-muted">
              <BanIcon className="size-3.5" aria-hidden /> Considered · rejected
            </span>
          ) : next ? (
            <span className="inline-flex items-center gap-1 text-meta text-ink-muted">
              <ArrowRightIcon className="size-3.5" aria-hidden /> Next step
            </span>
          ) : (
            status && (
              <StatusPill
                status={status}
                label={option.recheck && `${status === "provisional" ? "Allowed · demo policy" : verdictWords(status)} · ${option.recheck.allowedUses} of ${option.recheck.totalUses}`}
              />
            )
          )}
        </div>
        {rejected && option.notViableBecause && <p className="text-small text-ink-soft">{option.notViableBecause}</p>}
        {option.timeline && <EditPlanView timeline={option.timeline} chosen={chosen} compact />}
        <ReplacementLine option={option} />
        <MarketsChange option={option} plan={plan} />
        {next ? (
          <p className="text-small text-ink-soft">{option.summary}</p>
        ) : (
          !rejected && !option.changesGoal && <p className="text-meta text-ink-muted">{option.tradeoff}</p>
        )}
        <GoalChange option={option} />
        {selectable && (
          <Button variant="outline" size="sm" className="h-8 bg-transparent px-3" disabled={disabled} onClick={onSelect} aria-label={`Compare: ${option.title}`}>
            Compare
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * The edit PULSE tried before suggesting anything else, and why it was rejected. Calm and intentional: a
 * correctly rejected cut is a decision, not an error.
 */
function TriedFirst({ option, chosen }: { option: RecoveryOption; chosen?: { start: number; end: number } }) {
  const rc = option.recheck;
  const verdict = option.notViableBecause
    ? option.notViableBecause.replace(/^trim rejected:\s*/i, "")
    : rc
      ? `still restricted after the cut — ${rc.allowedUses} of ${rc.totalUses} uses allowed`
      : "it doesn't clear the restriction";
  return (
    <section aria-label="What PULSE tried first" className="space-y-3 rounded-lg bg-obsidian/60 px-4 py-4 ring-1 ring-line ring-inset">
      <p className="flex items-start gap-2 text-small text-ink-soft">
        <ScissorsIcon className="mt-0.5 size-3.5 shrink-0 text-ink-muted" aria-hidden />
        <span>
          First, PULSE tried cutting the flagged footage
          <span className="block text-meta text-ink-muted">{option.title}</span>
        </span>
      </p>
      <p className="flex items-start gap-2 text-small text-ink">
        <ArrowRightIcon className="mt-0.5 size-3.5 shrink-0 text-ink-muted" aria-hidden />
        <span>
          <span className="font-medium">Rejected:</span> {verdict}
        </span>
      </p>
      {option.timeline && <EditPlanView timeline={option.timeline} chosen={chosen} compact />}
    </section>
  );
}

// ---------- The editor ----------

type EditorProps = {
  goal: GoalView;
  recovery: RecoveryView;
  /** Any action is running. */
  disabled: boolean;
  /** Option being applied (its re-check shows progress). */
  applyingId: string | null;
  applyProgress?: { stages: Stage[]; note?: string };
  onApply: (optionId: string) => void;
  onChooseAsset: () => void;
  onChangeSettings: () => void;
  onSubmit: () => void;
};

/**
 * Media Compliance Recovery — "Find a way to use it". The original moment with the restricted seconds marked,
 * the suggested correction (recommended first, large) with its before/after cut and its independent re-check,
 * every other option as a compact row (rejected ones say why), and one decision. Nothing here is legal
 * clearance: a demo-policy ALLOWED is labelled as such, a cut is an edit plan, not a file.
 */
export function ComplianceEditor({ goal, recovery, disabled, applyingId, applyProgress, onApply, onChooseAsset, onChangeSettings, onSubmit }: EditorProps) {
  const uid = useId();
  const plan = goal.campaign?.plan ?? goal.run.plan;
  const options = recovery.options;
  const recommended = options.find((o) => o.id === recovery.recommendedId && o.applicable) ?? options.find((o) => o.recommended && o.applicable);
  const [chosenId, setChosenId] = useState(() => recommended?.id ?? options.find((o) => o.applicable)?.id);
  const featured = options.find((o) => o.id === chosenId && o.applicable);
  /** The cut PULSE tried first and rejected: told once, as the reason the suggestion is something else. */
  const tried = recommended?.kind === "TRIM" ? undefined : options.find((o) => o.kind === "TRIM" && (o.outcome === "NOT_VIABLE" || o.outcome === "STILL_BLOCKED"));
  const rest = options.filter((o) => o !== featured && o !== tried);
  const media = goal.campaign?.media;
  /** The campaign's selected range (a SAFE_SECTION timeline spans its own section, not the original). */
  const span = media ? { start: media.startSeconds, end: media.endSeconds } : options.find((o) => o.kind === "TRIM" && o.timeline)?.timeline?.original;
  const timed = recovery.problem.items.flatMap((x, i) => (x.at ? [{ n: i + 1, ...x.at }] : []));
  const noPath = !featured;

  return (
    <div id="resolution" className="scroll-mt-24 space-y-8">
      <div>
        <Eyebrow>Find a way to use it</Eyebrow>
        <h3 className="mt-2 font-display text-[1.0625rem] font-medium text-ink">Same goal: {goal.run.objective.summary}</h3>
      </div>

      {/* Original moment */}
      <section aria-labelledby={`${uid}-orig`} className="space-y-3">
        <h4 id={`${uid}-orig`} className="text-small font-medium text-ink-muted">
          Original moment
        </h4>
        {media && (
          <div>
            <p className="font-display text-[1.0625rem] font-medium text-ink" title={media.title}>
              {displayTitle(media.title)}
            </p>
            {span && (
              <p className="tabular mt-0.5 text-meta text-ink-muted">
                {spanText(span)} · {secs(span.end - span.start)}
              </p>
            )}
          </div>
        )}
        <p className="text-small text-ink">{recovery.problem.headline}</p>
        {span && (
          <figure>
            <figcaption className="sr-only">
              Selected range {spanText(span)}.{" "}
              {timed.length > 0 ? `Restricted: ${timed.map((m) => `${m.n}, ${spanText(m)}`).join("; ")}.` : "No timed restriction; it applies to the whole clip."}
            </figcaption>
            <RangeTrack span={span} marks={timed} />
          </figure>
        )}
        {recovery.problem.items.length > 0 && (
          <ol className="space-y-1.5 text-small">
            {recovery.problem.items.map((x, i) => (
              <li key={i} className="flex gap-2.5">
                <span className="tabular mt-px flex size-[1.125rem] shrink-0 items-center justify-center rounded-sm bg-surface-raised font-mono text-[0.6875rem] text-status-blocked ring-1 ring-status-blocked/40">
                  {i + 1}
                </span>
                <span className="text-ink-soft">
                  {x.text}
                  {!(x.at && x.text.includes(spanText(x.at))) && (
                    <span className="tabular text-ink-muted">
                      {" · "}
                      <span className="whitespace-nowrap">{x.at ? spanText(x.at) : "whole clip"}</span>
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {tried && <TriedFirst option={tried} chosen={span} />}

      {/* Suggested correction */}
      <section aria-labelledby={`${uid}-fix`} aria-busy={applyingId !== null} className="space-y-4 border-t border-line pt-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id={`${uid}-fix`} className="scroll-mt-28 text-small font-medium text-ink-muted">
            {noPath ? "No correction clears it" : featured.recommended ? "Suggested correction" : "Selected correction"}
          </h4>
          {featured?.recommended && (
            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-meta text-ink ring-1 ring-line-strong ring-inset">
              <CheckIcon className="size-3" aria-hidden /> Recommended
            </span>
          )}
        </div>
        {noPath ? (
          <p role="status" className="flex items-start gap-3 rounded-lg bg-obsidian px-4 py-4 text-body text-ink ring-1 ring-status-review/40 ring-inset">
            <TriangleAlertIcon className="mt-1 size-4 shrink-0 text-status-review" aria-hidden />
            <span>{recovery.noPathMessage ?? "None of the corrections clears every use under these rules. The options below explain why."}</span>
          </p>
        ) : (
          <Swap id={featured.id}>
            <FeaturedOption option={featured} plan={plan} chosen={span} progress={applyingId === featured.id ? applyProgress : undefined} />
          </Swap>
        )}
      </section>

      {/* Other options */}
      {rest.length > 0 && (
        <section aria-labelledby={`${uid}-other`} className="border-t border-line pt-6">
          <h4 id={`${uid}-other`} className="text-small font-medium text-ink-muted">
            {noPath ? "What PULSE tried" : "Other ways"} · {rest.length}
          </h4>
          <ul className="divide-y divide-line">
            {rest.map((o, i) => (
              <li key={o.id}>
                <Reveal delay={0.06 * i}>
                  <OptionRow
                    option={o}
                    plan={plan}
                    chosen={span}
                    selectable={o.applicable}
                    disabled={disabled}
                    onSelect={() => {
                      setChosenId(o.id);
                      document.getElementById(`${uid}-fix`)?.scrollIntoView({ block: "start", behavior: "smooth" });
                    }}
                  />
                </Reveal>
              </li>
            ))}
          </ul>
        </section>
      )}

      <EvidenceDetails goal={goal} recovery={recovery} />

      {/* Decision */}
      <section aria-labelledby={`${uid}-decide`} className="space-y-3 border-t border-line pt-6">
        <h4 id={`${uid}-decide`} className="sr-only">
          Decision
        </h4>
        {featured && (
          <>
            <Button size="lg" className="h-10 w-full rounded-lg px-4 text-[0.9375rem] font-semibold sm:w-auto" disabled={disabled} onClick={() => onApply(featured.id)}>
              {applyingId === featured.id ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Use revised plan
            </Button>
            <p className="text-meta text-ink-muted">
              {featured.changesGoal ? "This changes what the campaign does. " : ""}Saves the change as a new campaign version and records the re-check.
            </p>
          </>
        )}
        <div className="flex flex-wrap items-center gap-x-1 gap-y-2">
          <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onChooseAsset}>
            <ArrowLeftRightIcon /> Choose another asset
          </Button>
          <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onChangeSettings}>
            <SlidersHorizontalIcon /> Change campaign settings
          </Button>
          {goal.canSubmit && (
            <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onSubmit}>
              <SendIcon /> Send for human review
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}

/** Sources, run labels, rule ids, policy versions and evaluation times: for the people who audit, not by default. */
function EvidenceDetails({ goal, recovery }: { goal: GoalView; recovery: RecoveryView }) {
  return (
    <details className="group/e border-t border-line pt-4">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-meta text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 transition-transform group-open/e:rotate-90" aria-hidden /> Evidence and rule details
      </summary>
      <div className="mt-3 space-y-4 text-meta text-ink-muted">
        <div>
          <p className="text-ink-soft">What was observed</p>
          <ul className="mt-1 space-y-1">
            {recovery.problem.items.map((x, i) => (
              <li key={i}>
                {i + 1}. {x.at ? `${spanText(x.at)} · ` : ""}
                {x.source}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-ink-soft">Each option&apos;s re-check</p>
          <ul className="mt-1 space-y-1">
            {recovery.options.map((o) => (
              <li key={o.id} className="break-words">
                {o.title}
                {o.recheck ? ` · ${o.recheck.policyId} v${o.recheck.policyVersion} · ${utc(o.recheck.evaluatedAt)}` : " · not re-checked"}
                {o.timeline && ` · edit plan ${o.timeline.edlId}`}
                {o.replacement && ` · ScorePlay ${o.replacement.scoreplayMediaId}`}
              </li>
            ))}
          </ul>
        </div>
        <p className="break-words">
          {goal.policy && `Rules: ${goal.policy.title} · ${goal.policy.packageId} v${goal.policy.version}. `}
          Options generated {utc(recovery.generatedAt)} for evaluation {recovery.forEvaluationId}.
        </p>
      </div>
    </details>
  );
}

// ---------- After applying ----------

/**
 * Resolution: what the applied change did, as REROUTE judged it before and after. A demo-policy ALLOWED keeps its
 * label; a cut shows its plan (never a rendered file).
 */
export function BeforeAfterPanel({ beforeAfter: ba, chosen, totalNow }: { beforeAfter: BeforeAfter; chosen?: { start: number; end: number }; totalNow?: number }) {
  const before = rightsStatus(ba.before.verdict);
  const after = ba.after ? rightsStatus(ba.after.verdict, ba.after.clearance) : null;
  const k = KIND[ba.kind];
  const sentence = `Before: ${verdictWords(before)} · ${ba.before.allowedUses} of ${ba.before.totalUses} uses → After: ${
    ba.after && after ? `${verdictWords(after)} · ${ba.after.allowedUses} of ${ba.after.totalUses} uses` : `not checked yet${totalNow ? ` · ${totalNow} uses` : ""}`
  }`;
  return (
    <section id="resolution" aria-label="Before and after" className="scroll-mt-24 space-y-4">
      <div>
        <Eyebrow>Resolution</Eyebrow>
        <p className="mt-2 flex items-start gap-2 text-small text-ink">
          <k.Icon className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden />
          <span>
            {ba.title}
            <span className="block text-meta text-ink-muted">{k.label}</span>
          </span>
        </p>
      </div>
      <p className="sr-only">{sentence}</p>
      <div aria-hidden className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2">
        <Side label="Before" status={before} uses={`${ba.before.allowedUses} of ${ba.before.totalUses} uses`} title={ba.before.title} />
        <ArrowRightIcon className="size-4 self-center text-ink-muted" />
        {ba.after && after ? (
          <Side label="After" status={after} uses={`${ba.after.allowedUses} of ${ba.after.totalUses} uses`} title={ba.after.title} />
        ) : (
          <Side label="After" status="stale" uses="Check rights to see" title="" />
        )}
      </div>
      {after === "provisional" && <p className="text-meta text-ink-muted">Allowed under the demo policy · not legal clearance</p>}
      {ba.timeline && <EditPlanView timeline={ba.timeline} chosen={chosen} />}
    </section>
  );
}

function Side({ label, status, uses, title }: { label: string; status: Status; uses: string; title: string }) {
  return (
    <div className={cn("min-w-0 space-y-1.5 rounded-lg px-3 py-3 ring-1 ring-inset", status === "provisional" || status === "clear" ? "ring-line-strong" : "ring-line")}>
      <p className="text-eyebrow font-medium text-ink-muted uppercase">{label}</p>
      <StatusPill status={status} label={verdictWords(status)} className="whitespace-normal" />
      <p className="tabular text-small text-ink">{uses}</p>
      {title && (
        <p className="truncate text-meta text-ink-muted" title={title}>
          {displayTitle(title)}
        </p>
      )}
    </div>
  );
}
