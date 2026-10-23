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
import { Swap } from "@/components/pulse/motion";
import { Button } from "@/components/ui/button";
import { utc } from "@/components/reroute/shared";
import { cn } from "@/lib/utils";
import type { BeforeAfter, EditTimeline, GoalView, RecoveryKind, RecoveryOption, RecoveryView } from "../types";
import { CHANNEL_LABEL, StagedProgress, StatusPill, country, displayTitle, rightsStatus, usageWord, type Stage, type Status } from "./parts";

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
  TRIM: { label: "Remove restricted segment", Icon: ScissorsIcon },
  SAFE_SECTION: { label: "Use the clean section", Icon: CropIcon },
  REPLACE: { label: "Use another clip", Icon: ReplaceIcon },
  ADAPT_CAMPAIGN: { label: "Change campaign markets", Icon: MapIcon },
  CHANGE_USAGE: { label: "Change the type of post", Icon: MegaphoneIcon },
  REQUEST_CLEARANCE: { label: "Ask for clearance", Icon: MailIcon },
};

/** The decision words of the Rights & Compliance step (an illustrative "Ready to use" carries the policy chip). */
export const DECISION: Record<Status, string> = {
  idle: "Not checked yet",
  stale: "Needs a fresh check",
  clear: "Ready to use",
  provisional: "Ready to use",
  blocked: "Restriction found",
  review: "Needs review",
};

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

type Recheck = NonNullable<RecoveryOption["recheck"]>;

/** "2 allowed · 0 restricted · 1 unresolved": every use counted once — an unknown is never counted as allowed. */
const countsLine = (rc: Recheck) => `${rc.allowedUses} allowed · ${rc.restrictedUses} restricted · ${rc.unresolvedUses} unresolved`;

/** What still stands in the way; a consolidated line (several people named by AI) keeps each finding one click away. */
function RemainingList({ items }: { items: Recheck["remaining"] }) {
  return (
    <ul className="space-y-1.5 text-small">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2">
          <XIcon className="mt-1 size-3 shrink-0 text-status-review" aria-hidden />
          <span className="min-w-0 text-ink-soft">
            {x.text}
            {x.at && <span className="tabular text-ink-muted"> · {spanText(x.at)}</span>}
            <span className="block text-meta text-ink-muted">{x.source}</span>
            {x.details && x.details.length > 0 && (
              <details className="group/d mt-1">
                <summary className="flex cursor-pointer list-none items-center gap-1 text-meta text-ink-muted hover:text-ink [&::-webkit-details-marker]:hidden">
                  <ChevronRightIcon className="size-3 transition-transform group-open/d:rotate-90" aria-hidden /> Each finding · {x.details.length}
                </summary>
                <ul className="mt-1 space-y-1 text-meta text-ink-muted">
                  {x.details.map((d, j) => (
                    <li key={j}>
                      {d.text}
                      {d.at && <span className="tabular"> · {spanText(d.at)}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** The re-check of an option in one line ("Re-checked: 3 of 3 uses allowed under these rules"); full counts are in the details. */
function RecheckLine({ option, progress }: { option: RecoveryOption; progress?: { stages: Stage[]; note?: string } }) {
  if (progress) return <StagedProgress stages={progress.stages} note={progress.note} />;
  const rc = option.recheck;
  if (!rc) return null;
  const status = rightsStatus(rc.verdict, rc.clearance);
  return (
    <div className="space-y-2">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink">
        <span className="tabular">
          Re-checked: {rc.allowedUses} of {rc.totalUses} uses allowed under these rules
        </span>
        <StatusPill status={status} label={DECISION[status]} />
      </p>
      {rc.remaining.length > 0 && <RemainingList items={rc.remaining} />}
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
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 ring-1 ring-line ring-inset">
      <span className="tabular shrink-0 rounded bg-surface-raised px-1.5 py-1 font-mono text-meta text-ink">{spanText(r)}</span>
      <p className="min-w-0 truncate text-small font-medium text-ink" title={r.title}>
        {displayTitle(r.title)}
      </p>
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

/** The suggested fix: what changes, the cut (if any), its re-check in one line and the trade-off. */
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
          <h4 className="font-display text-[1.25rem] leading-tight font-medium text-ink">{k.label}</h4>
          <p className="mt-0.5 text-meta text-ink-muted">{option.title}</p>
        </div>
      </div>
      <p className="text-small text-ink-soft">{option.summary}</p>
      {option.timeline && <EditPlanView timeline={option.timeline} chosen={chosen} />}
      <ReplacementLine option={option} />
      <MarketsChange option={option} plan={plan} />
      <RecheckLine option={option} progress={progress} />
      {option.changesGoal ? <GoalChange option={option} /> : <p className="text-meta text-ink-muted">Trade-off: {option.tradeoff}</p>}
    </div>
  );
}

/** Another option whose re-check clears every use: one row, "Compare" brings it up as the suggested fix. */
function OtherOption({ option, disabled, onCompare }: { option: RecoveryOption; disabled: boolean; onCompare: () => void }) {
  const k = KIND[option.kind];
  const rc = option.recheck;
  return (
    <div className="flex items-center gap-3 py-3">
      <k.Icon className="size-4 shrink-0 text-ink-soft" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-small font-medium text-ink">{k.label}</p>
        <p className="truncate text-meta text-ink-muted" title={option.title}>
          {option.title}
          {rc && ` · re-checked: ${rc.allowedUses} of ${rc.totalUses} allowed`}
        </p>
      </div>
      <Button variant="outline" size="sm" className="h-8 shrink-0 bg-transparent px-3" disabled={disabled} onClick={onCompare} aria-label={`Compare: ${option.title}`}>
        Compare
      </Button>
    </div>
  );
}

type NotUsable = "review" | "rejected" | "next";

const NOT_USABLE: Record<NotUsable, { label: string; Icon: typeof BanIcon }> = {
  review: { label: "Still needs review", Icon: TriangleAlertIcon },
  rejected: { label: "Doesn't clear the restriction", Icon: BanIcon },
  next: { label: "Next step", Icon: ArrowRightIcon },
};

/**
 * An option that is not a fix: a candidate a reviewer still has to clear (with what remains and the explicit "use it
 * anyway" escape), a rejected one (why, no action) or a next step. Muted; never styled as a success.
 */
function NotUsableRow({
  option,
  chosen,
  kind,
  disabled,
  applying,
  onApply,
}: {
  option: RecoveryOption;
  chosen?: { start: number; end: number };
  kind: NotUsable;
  disabled: boolean;
  applying: boolean;
  onApply: () => void;
}) {
  const k = KIND[option.kind];
  const n = NOT_USABLE[kind];
  const rc = option.recheck;
  return (
    <div className="flex gap-3 py-4">
      <k.Icon className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 text-small text-ink-soft">
            <span className="font-medium">{k.label}</span> <span className="text-ink-muted">· {option.title}</span>
          </p>
          <span className={cn("inline-flex items-center gap-1 text-meta", kind === "review" ? "text-status-review" : "text-ink-muted")}>
            <n.Icon className="size-3.5" aria-hidden /> {n.label}
          </span>
        </div>
        {kind === "rejected" && <p className="text-small text-ink-muted">{option.notViableBecause ?? "It doesn't clear the restriction."}</p>}
        {kind === "review" && rc && (
          <>
            <p className="tabular text-meta text-ink-muted">
              Not a fix — re-checked: {rc.allowedUses} of {rc.totalUses} uses allowed. A reviewer must clear what remains.
            </p>
            {rc.remaining.length > 0 && <RemainingList items={rc.remaining} />}
          </>
        )}
        {kind === "next" && <p className="text-small text-ink-muted">{option.summary}</p>}
        {option.timeline && kind !== "next" && <EditPlanView timeline={option.timeline} chosen={chosen} compact />}
        <ReplacementLine option={option} />
        {kind === "review" && option.applicable && (
          <Button variant="ghost" size="sm" className="-ml-2 h-8 px-2 text-ink-muted" disabled={disabled} onClick={onApply} aria-label={`Use anyway, still needs review: ${option.title}`}>
            {applying && <Loader2Icon className="animate-spin" />} Use it anyway — still needs review
          </Button>
        )}
      </div>
    </div>
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
 * "Fix this clip": the suggested fix (only an option whose independent re-check clears every use) with its
 * original-vs-revised cut and "Use revised plan", other options that also clear the re-check, and — collapsed and
 * clearly apart — what is not usable yet (review-required candidates, rejected options, next steps). The restriction
 * itself, timecodes and every re-check's provenance sit behind "Why? View details". Nothing here is legal clearance:
 * a cut is an edit plan, not a file.
 */
export function ComplianceEditor({ goal, recovery, disabled, applyingId, applyProgress, onApply, onChooseAsset, onChangeSettings, onSubmit }: EditorProps) {
  const uid = useId();
  const plan = goal.campaign?.plan ?? goal.run.plan;
  const options = recovery.options;
  /** Re-checked ALLOWED for every use: the only options that may be featured as a correction. */
  const verified = options.filter((o) => o.outcome === "RESOLVES_DEMO" && o.applicable);
  const recommended = verified.find((o) => o.id === recovery.recommendedId) ?? verified.find((o) => o.recommended);
  const [chosenId, setChosenId] = useState(() => recommended?.id);
  const featured = verified.find((o) => o.id === chosenId);
  const others = verified.filter((o) => o !== featured);
  const notUsable: { option: RecoveryOption; kind: NotUsable }[] = [
    ...options.filter((o) => o.outcome === "NEEDS_REVIEW").map((option) => ({ option, kind: "review" as const })),
    ...options.filter((o) => o.outcome === "NOT_VIABLE" || o.outcome === "STILL_BLOCKED").map((option) => ({ option, kind: "rejected" as const })),
    ...options.filter((o) => o.outcome === "NEXT_STEP").map((option) => ({ option, kind: "next" as const })),
  ];
  const media = goal.campaign?.media;
  /** The campaign's selected range (a SAFE_SECTION timeline spans its own section, not the original). */
  const span = media ? { start: media.startSeconds, end: media.endSeconds } : options.find((o) => o.kind === "TRIM" && o.timeline)?.timeline?.original;

  return (
    <div id="resolution" className="scroll-mt-24 space-y-7">
      <section aria-labelledby={`${uid}-fix`} aria-busy={applyingId !== null} className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id={`${uid}-fix`} className="scroll-mt-28 text-eyebrow font-medium text-ink-muted uppercase">
            {featured ? "Suggested fix" : "No verified fix"}
          </h3>
          {featured && !featured.recommended && <span className="text-meta text-ink-muted">Comparing another option</span>}
        </div>
        {!featured ? (
          <p role="status" className="flex items-start gap-3 text-small text-ink-soft">
            <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-status-review" aria-hidden />
            <span>{recovery.noPathMessage ?? "No option keeps the goal and clears every use under these rules."}</span>
          </p>
        ) : (
          <>
            <Swap id={featured.id}>
              <FeaturedOption option={featured} plan={plan} chosen={span} progress={applyingId === featured.id ? applyProgress : undefined} />
            </Swap>
            <div className="space-y-2">
              <Button size="lg" className="h-10 w-full rounded-lg px-4 text-[0.9375rem] font-semibold sm:w-auto" disabled={disabled} onClick={() => onApply(featured.id)}>
                {applyingId === featured.id ? <Loader2Icon className="animate-spin" /> : <CheckIcon />} Use revised plan
              </Button>
              <p className="text-meta text-ink-muted">
                {featured.changesGoal ? "This changes what the campaign does. " : ""}Saved as a new campaign version with its re-check.
              </p>
            </div>
          </>
        )}
      </section>

      {others.length > 0 && (
        <section aria-labelledby={`${uid}-other`} className="border-t border-line pt-4">
          <h4 id={`${uid}-other`} className="text-small font-medium text-ink-muted">
            Other options
          </h4>
          <ul className="divide-y divide-line">
            {others.map((o) => (
              <li key={o.id}>
                <OtherOption
                  option={o}
                  disabled={disabled}
                  onCompare={() => {
                    setChosenId(o.id);
                    document.getElementById(`${uid}-fix`)?.scrollIntoView({ block: "start", behavior: "smooth" });
                  }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {notUsable.length > 0 && (
        <details className="group/n rounded-lg bg-obsidian/40 px-4 ring-1 ring-line ring-inset">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-small text-ink-muted transition-colors hover:text-ink [&::-webkit-details-marker]:hidden">
            <span>Not usable yet · {notUsable.length}</span>
            <ChevronRightIcon className="size-4 shrink-0 transition-transform group-open/n:rotate-90" aria-hidden />
          </summary>
          <ul className="divide-y divide-line border-t border-line">
            {notUsable.map(({ option, kind }) => (
              <li key={option.id}>
                <NotUsableRow option={option} chosen={span} kind={kind} disabled={disabled} applying={applyingId === option.id} onApply={() => onApply(option.id)} />
              </li>
            ))}
          </ul>
        </details>
      )}

      <EvidenceDetails goal={goal} recovery={recovery} span={span} />

      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-t border-line pt-4">
        <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onChooseAsset}>
          <ArrowLeftRightIcon /> Choose another clip
        </Button>
        <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onChangeSettings}>
          <SlidersHorizontalIcon /> Change campaign
        </Button>
        {goal.canSubmit && (
          <Button variant="ghost" size="sm" className="text-ink-muted" disabled={disabled} onClick={onSubmit}>
            <SendIcon /> Send as is
          </Button>
        )}
      </div>
    </div>
  );
}

/** The restriction located in time, every option's full re-check and its provenance: for the people who audit, not by default. */
function EvidenceDetails({ goal, recovery, span }: { goal: GoalView; recovery: RecoveryView; span?: { start: number; end: number } }) {
  const timed = recovery.problem.items.flatMap((x, i) => (x.at ? [{ n: i + 1, ...x.at }] : []));
  return (
    <details className="group/e">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded text-small text-ink-muted transition-colors hover:text-ink focus-visible:ring-2 focus-visible:ring-signal focus-visible:outline-none [&::-webkit-details-marker]:hidden">
        <ChevronRightIcon className="size-3.5 transition-transform group-open/e:rotate-90" aria-hidden /> Why? View details
      </summary>
      <div className="mt-4 space-y-5 text-meta text-ink-muted">
        <section className="space-y-3">
          <p className="text-small text-ink-soft">{recovery.problem.headline}</p>
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
                  <span className="min-w-0 text-ink-soft">
                    {x.text}
                    {!(x.at && x.text.includes(spanText(x.at))) && (
                      <span className="tabular text-ink-muted">
                        {" · "}
                        <span className="whitespace-nowrap">{x.at ? spanText(x.at) : "whole clip"}</span>
                      </span>
                    )}
                    <span className="block text-meta text-ink-muted">{x.source}</span>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        <section>
          <p className="text-ink-soft">Each option&apos;s re-check</p>
          <ul className="mt-1 space-y-1">
            {recovery.options.map((o) => (
              <li key={o.id} className="break-words">
                <span className="text-ink-soft">{o.title}</span>
                {o.recheck
                  ? ` · ${countsLine(o.recheck)} (${o.recheck.totalUses} uses) · ${o.recheck.policyId} v${o.recheck.policyVersion} · ${utc(o.recheck.evaluatedAt)}`
                  : " · not re-checked"}
                {o.timeline && ` · edit plan ${o.timeline.edlId}`}
                {o.replacement && ` · ScorePlay ${o.replacement.scoreplayMediaId} · search rank ${o.replacement.rank} for “${o.replacement.query}”`}
              </li>
            ))}
          </ul>
        </section>
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
 * The revised plan: what the applied change did, as REROUTE judged it before and after, and its full edit plan
 * (never a rendered file).
 */
export function BeforeAfterPanel({ beforeAfter: ba, chosen, totalNow }: { beforeAfter: BeforeAfter; chosen?: { start: number; end: number }; totalNow?: number }) {
  const before = rightsStatus(ba.before.verdict);
  const after = ba.after ? rightsStatus(ba.after.verdict, ba.after.clearance) : null;
  const k = KIND[ba.kind];
  const sentence = `Before: ${DECISION[before]} · ${ba.before.allowedUses} of ${ba.before.totalUses} uses → After: ${
    ba.after && after ? `${DECISION[after]} · ${ba.after.allowedUses} of ${ba.after.totalUses} uses` : `not checked yet${totalNow ? ` · ${totalNow} uses` : ""}`
  }`;
  const replaced = ba.after && ba.after.title !== ba.before.title;
  return (
    <section id="resolution" aria-labelledby="revised-plan-title" className="scroll-mt-24 space-y-4">
      <div>
        <h3 id="revised-plan-title" className="text-eyebrow font-medium text-ink-muted uppercase">
          Revised plan
        </h3>
        <p className="mt-2 flex items-start gap-2 text-small text-ink">
          <k.Icon className="mt-0.5 size-4 shrink-0 text-ink-soft" aria-hidden />
          <span>
            {k.label}
            <span className="block text-meta text-ink-muted">{ba.title}</span>
          </span>
        </p>
      </div>
      <p className="sr-only">{sentence}</p>
      <div aria-hidden className="grid gap-1.5">
        <Side label="Before" status={before} uses={`${ba.before.allowedUses} of ${ba.before.totalUses} uses`} title={replaced ? ba.before.title : undefined} />
        {ba.after && after ? (
          <Side label="After" status={after} uses={`${ba.after.allowedUses} of ${ba.after.totalUses} uses`} title={replaced ? ba.after.title : undefined} />
        ) : (
          <Side label="After" status="stale" uses="check rights to see" />
        )}
      </div>
      {ba.timeline && <EditPlanView timeline={ba.timeline} chosen={chosen} />}
    </section>
  );
}

function Side({ label, status, uses, title }: { label: string; status: Status; uses: string; title?: string }) {
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="w-[3.25rem] text-meta text-ink-muted">{label}</span>
      <StatusPill status={status} label={DECISION[status]} />
      <span className="tabular text-meta text-ink-muted">{uses}</span>
      {title && (
        <span className="max-w-[14rem] truncate text-meta text-ink-muted" title={title}>
          · {displayTitle(title)}
        </span>
      )}
    </span>
  );
}
