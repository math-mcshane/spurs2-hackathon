"use client";

import { useEffect, useState } from "react";
import {
  CircleAlertIcon,
  CircleCheckIcon,
  CircleDashedCheckIcon,
  CircleDashedIcon,
  CircleHelpIcon,
  CircleSlashIcon,
  HistoryIcon,
  InfoIcon,
  Loader2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { DEMO_CLEARANCE_LABEL, type Clearance } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { MARKETS } from "../objective-parser";
import { MarketCodeSchema, type ChannelRights, type ReasonFinding, type RightsState, type RunProvenance } from "../types";

// ---------- Rights status: semantic colour + icon + word, never the brand accent ----------

export type Status = "idle" | "stale" | "clear" | "provisional" | "review" | "blocked";

/** `clear` only for ALLOWED under VERIFIED clearance; ALLOWED under a demo policy is `provisional`. */
export function rightsStatus(state: RightsState, clearance?: Clearance): Status {
  if (state === "ALLOWED") return clearance === "VERIFIED" ? "clear" : "provisional";
  return state === "BLOCKED" ? "blocked" : state === "NEEDS_REVIEW" ? "review" : "idle";
}

export const STATUS: Record<Status, { label: string; text: string; Icon: typeof CircleCheckIcon }> = {
  idle: { label: "Not checked", text: "text-status-idle", Icon: CircleDashedIcon },
  stale: { label: "Out of date", text: "text-status-idle", Icon: HistoryIcon },
  clear: { label: "Cleared", text: "text-status-clear", Icon: CircleCheckIcon },
  provisional: { label: "Allowed · demo policy", text: "text-status-provisional", Icon: CircleDashedCheckIcon },
  review: { label: "Needs review", text: "text-status-review", Icon: CircleHelpIcon },
  blocked: { label: "Blocked", text: "text-status-blocked", Icon: CircleSlashIcon },
};

export function StatusPill({ status, label, className }: { status: Status; label?: string; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-meta font-medium whitespace-nowrap", s.text, className)}>
      <s.Icon className="size-3.5 shrink-0" aria-hidden />
      {label ?? s.label}
    </span>
  );
}

/** Large status glyph for a decision headline. */
export function StatusMark({ status, className }: { status: Status; className?: string }) {
  const s = STATUS[status];
  return (
    <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full bg-current/10 ring-1 ring-current/25", s.text, className)} aria-hidden>
      <s.Icon className="size-5" />
    </span>
  );
}

/** "DEMO POLICY — NOT VERIFIED LEGAL CLEARANCE" in sentence case; any other server label verbatim. */
export function demoLabelText(label: string = DEMO_CLEARANCE_LABEL): string {
  return label === DEMO_CLEARANCE_LABEL ? "Demo policy — not verified legal clearance" : label;
}

/** Server sentences that embed the shouted demo label, with the label in sentence case. */
export const calmDemoLabel = (text: string) => text.replaceAll(DEMO_CLEARANCE_LABEL, demoLabelText());

/** The label every fictional-policy decision carries. Calm, persistent, never dismissible. */
export function DemoPolicyNote({ label, className }: { label?: string; className?: string }) {
  return (
    <p role="note" className={cn("flex items-start gap-2 rounded-md border border-dashed border-status-review/45 px-3 py-2 text-small text-ink-soft", className)}>
      <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-status-review" aria-hidden />
      <span>{demoLabelText(label)}</span>
    </p>
  );
}

// ---------- Typography helpers ----------

export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-eyebrow font-medium text-ink-muted uppercase", className)}>{children}</p>;
}

// ---------- Labels ----------

export const CHANNEL_LABEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X", youtube: "YouTube", tiktok: "TikTok" };
const USAGE_LABEL: Record<string, string> = { COMMERCIAL: "commercial", EDITORIAL: "editorial", ORGANIC: "organic", SPONSORED: "sponsored" };

const REGION = new Intl.DisplayNames(["en-GB"], { type: "region", fallback: "code" });

/** "GB" → "United Kingdom" (the parser's own label first, then the platform's region names). */
export function country(code: string): string {
  const m = MarketCodeSchema.safeParse(code);
  if (m.success) return MARKETS[m.data].label;
  try {
    return REGION.of(code) ?? code;
  } catch {
    return code;
  }
}

export const channelList = (channels: readonly string[]) => channels.map((c) => CHANNEL_LABEL[c] ?? c).join(", ");
export const usageWord = (usage: string) => USAGE_LABEL[usage] ?? usage.toLowerCase();

/** "Instagram, Facebook, X in United Kingdom" or "… in 7 markets". */
export function usesPhrase(channels: readonly string[], territories: readonly string[]): string {
  const where = territories.length === 1 ? country(territories[0]) : `${territories.length} markets`;
  return `${channelList(channels)} in ${where}`;
}

export function duration(sec: number): string {
  return sec < 90 ? `${sec.toFixed(1)} s` : `${Math.floor(sec / 60)} min ${Math.round(sec % 60)} s`;
}

/** Filename without extension, separators as spaces: what a social manager recognizes. */
export function displayTitle(title: string): string {
  return title.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
}

// ---------- Rights issues: one entry per problem, not per channel × territory ----------

const TOPIC: Record<string, string> = {
  territory: "Market",
  platform: "Channel",
  usage: "Type of use",
  competition: "Competition licence",
  expiry: "Licence dates",
  people: "People on screen",
  sponsor: "Brands on screen",
};
/** Licence terms: a MISSING outcome there means "not licensed", not "not confirmed". */
const LICENCE: Record<string, true> = { territory: true, platform: true, usage: true, competition: true, expiry: true };

export type Issue = {
  key: string;
  topic: string;
  outcome: ReasonFinding["outcome"];
  /** A licence term (market, channel, use, competition, dates) rather than something on screen. */
  licence: boolean;
  /** Channel × territory uses this problem affects. */
  channels: string[];
  territories: string[];
  found: ReasonFinding["found"];
  rules: ReasonFinding["rule"][];
};

/**
 * Merges the per-use findings into problems: the same dimension + rule across channels and territories is
 * one issue that lists what it affects. Observations and rule texts are kept verbatim and de-duplicated.
 */
export function groupIssues(rows: readonly Pick<ChannelRights, "channel" | "territory" | "findings">[]): Issue[] {
  const byKey = new Map<string, Issue>();
  for (const row of rows) {
    for (const f of row.findings) {
      const key = `${f.dimension.toLowerCase()}|${f.rule.id ?? f.rule.text}|${f.outcome}`;
      const issue = byKey.get(key) ?? {
        key,
        topic: TOPIC[f.dimension.toLowerCase()] ?? f.dimension,
        outcome: f.outcome,
        licence: !!LICENCE[f.dimension.toLowerCase()],
        channels: [],
        territories: [],
        found: [],
        rules: [],
      };
      if (!issue.channels.includes(row.channel)) issue.channels.push(row.channel);
      if (!issue.territories.includes(row.territory)) issue.territories.push(row.territory);
      for (const x of f.found) if (!issue.found.some((y) => y.text === x.text && y.source === x.source)) issue.found.push(x);
      if (!issue.rules.some((r) => r.text === f.rule.text)) issue.rules.push(f.rule);
      byKey.set(key, issue);
    }
  }
  return [...byKey.values()].sort((a, b) => Number(b.outcome === "DENY") - Number(a.outcome === "DENY"));
}

/** Shows the first `max` items and a toggle for the rest. */
function More<T>({ items, max, render }: { items: T[]; max: number; render: (item: T, i: number) => React.ReactNode }) {
  const [all, setAll] = useState(false);
  const shown = all ? items : items.slice(0, max);
  return (
    <>
      {shown.map(render)}
      {items.length > max && (
        <button type="button" onClick={() => setAll(!all)} className="text-meta text-ink-muted underline-offset-2 hover:text-ink hover:underline">
          {all ? "Show fewer" : `+ ${items.length - max} similar`}
        </button>
      )}
    </>
  );
}

/**
 * One rights problem, with what was OBSERVED (real data, with its source) visibly separate from what the
 * RULE says (tagged fictional demo policy or verified policy). AI observation is evidence, never permission.
 */
export function IssueBlock({ issue, compact = false }: { issue: Issue; compact?: boolean }) {
  const deny = issue.outcome === "DENY";
  const fromPlan = issue.found.every((f) => f.source === "Your campaign plan");
  return (
    <li className="min-w-0 space-y-3 py-4 first:pt-0 last:pb-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-small font-medium text-ink">
          {issue.topic}{" "}
          <span className={deny ? "text-status-blocked" : "text-status-review"}>
            — {deny ? "not permitted" : issue.licence ? "not licensed" : "not confirmed"}
          </span>
        </p>
        {!compact && (
          <p className="shrink-0 text-meta text-ink-muted">
            {channelList(issue.channels)} · {issue.territories.join(", ")}
          </p>
        )}
      </div>
      <dl className="grid grid-cols-[4.75rem_minmax(0,1fr)] gap-x-3 gap-y-3 text-small">
        <dt className="pt-px text-eyebrow font-medium text-ink-muted uppercase">Observed</dt>
        <dd className="min-w-0 space-y-1.5 break-words">
          {fromPlan ? (
            <p className="text-ink-soft">
              Planned posts in {issue.territories.map(country).join(", ")}
              <Source>Your campaign plan</Source>
            </p>
          ) : (
            <More
              items={issue.found}
              max={2}
              render={(f, i) => (
                <p key={i} className="text-ink-soft">
                  {f.text}
                  <Source>{f.source}</Source>
                </p>
              )}
            />
          )}
        </dd>
        <dt className="pt-px text-eyebrow font-medium text-ink-muted uppercase">Rule</dt>
        <dd className="min-w-0 space-y-1.5 break-words">
          <More
            items={issue.rules}
            max={1}
            render={(r, i) => (
              <p key={i} className="text-ink-soft">
                {r.text}
                <Source tone={r.tag === "Verified policy" ? "verified" : "demo"}>
                  {r.tag === "Verified policy" ? "Verified policy" : "Demo policy"}
                  {r.id && ` · ${r.id}`}
                </Source>
              </p>
            )}
          />
        </dd>
      </dl>
    </li>
  );
}

function Source({ children, tone }: { children: React.ReactNode; tone?: "demo" | "verified" }) {
  return (
    <span
      className={cn(
        "mt-0.5 block text-meta",
        tone === "demo" ? "text-status-review/90" : tone === "verified" ? "text-status-clear" : "text-ink-muted",
      )}
    >
      {children}
    </span>
  );
}

// ---------- Long operations ----------

/** One step of a long server operation, expected to start `after` seconds in (an estimate, never a server signal). */
export type Stage = { after: number; text: string };

function useElapsed(): number {
  const [start] = useState(() => Date.now());
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSec(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(t);
  }, [start]);
  return sec;
}

/**
 * Progress for operations that can take 20–70 s on a cold cache: the current stage (estimated from elapsed
 * time, and labelled as an estimate), the stages done, and the elapsed seconds.
 */
export function StagedProgress({ stages, note, className }: { stages: Stage[]; note?: string; className?: string }) {
  const sec = useElapsed();
  const current = stages.reduce((at, s, i) => (sec >= s.after ? i : at), 0);
  return (
    <div role="status" aria-live="polite" className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2.5 text-small text-ink">
        <Loader2Icon className="size-4 shrink-0 animate-spin text-signal" aria-hidden />
        <span className="min-w-0 flex-1">{stages[current].text}…</span>
        <span className="tabular shrink-0 font-mono text-meta text-ink-muted">{sec} s</span>
      </div>
      <ol className="flex gap-1" aria-hidden>
        {stages.map((s, i) => (
          <li key={s.text} className={cn("h-0.5 flex-1 rounded-full transition-colors duration-500", i <= current ? "bg-signal/70" : "bg-line-strong")} />
        ))}
      </ol>
      <p className="text-meta text-ink-muted">Stage shown is an estimate{note ? ` · ${note}` : ""}</p>
    </div>
  );
}

// ---------- Data provenance ----------

/** LIVE / recorded provenance of the run's ScorePlay + TwelveLabs data. (Simulated signals never reach the Studio.) */
export function ProvenanceTag({ origin, className }: { origin: RunProvenance; className?: string }) {
  const live = origin.origin === "LIVE";
  const when = origin.recordedAt
    ? ` ${new Date(origin.recordedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}`
    : "";
  return (
    <span
      className={cn("inline-flex items-center gap-2 text-meta text-ink-muted", className)}
      title={live ? "Fetched live from ScorePlay and TwelveLabs for this run" : "Replayed from a recorded ScorePlay / TwelveLabs response, not fetched live for this run"}
    >
      <span className={cn("size-1.5 rounded-full", live ? "bg-ink" : "border border-ink-muted")} aria-hidden />
      {live ? "Live club data · ScorePlay + TwelveLabs" : origin.origin === "MIXED" ? `Partly recorded data${when}` : `Recorded data${when}`}
    </span>
  );
}

// ---------- Notices ----------

const NOTICE = {
  info: { Icon: InfoIcon, cls: "text-ink-soft", icon: "text-ink-muted" },
  warning: { Icon: TriangleAlertIcon, cls: "text-ink-soft", icon: "text-status-review" },
  error: { Icon: CircleAlertIcon, cls: "text-ink-soft", icon: "text-status-blocked" },
} as const;

/** One-line page-level message with optional actions. Calm: a hairline and an icon, no tinted panel. */
export function Notice({ tone = "info", children, actions, className }: { tone?: keyof typeof NOTICE; children: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  const n = NOTICE[tone];
  return (
    <div
      role={tone === "info" ? "status" : "alert"}
      className={cn("flex flex-col gap-3 rounded-lg border border-line-strong bg-surface px-4 py-3 text-small sm:flex-row sm:items-center", n.cls, className)}
    >
      <n.Icon className={cn("hidden size-4 shrink-0 sm:block", n.icon)} aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
    </div>
  );
}
