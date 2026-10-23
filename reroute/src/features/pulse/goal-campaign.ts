import type { EditPlan, PublishIntent } from "@/lib/contracts";
import { edlToEditPlan, type Edl } from "@/lib/rights/recovery/edl";
import { timecode } from "@/lib/rights/recovery/plan";
import { composeCampaign } from "./campaign-builder";
import { CLUBS } from "./clubs";
import { clock } from "./moment-ranking";
import { marketsLabel, objectiveMarkets } from "./objective-parser";
import { LanguageSchema, type CommerceDestination, type GoalCampaign, type GoalPlan, type GoalRun, type Language, type Recommendation } from "./types";

/**
 * Hooks per visual intent. They describe the *kind* of moment TwelveLabs matched, never facts it did
 * not establish (no scorer, team, minute, result or venue), so they stay true for any clip found —
 * including footage of the opponent.
 */
const HOOKS: Record<string, Partial<Record<Language, string>>> = {
  kit: { en: "Matchday detail.", es: "Detalles de día de partido.", fr: "Détails de jour de match." },
  celebration: { en: "Relive the moment.", es: "Revive el momento.", fr: "Revivez le moment." },
  "fans-colours": { en: "Matchday colours.", es: "Colores de día de partido.", fr: "Couleurs de jour de match." },
  "player-fan-bond": { en: "For the fans.", es: "Para la afición.", fr: "Pour les supporters." },
  score: { en: "Watch it again.", es: "Míralo otra vez.", fr: "À revoir." },
  "near-miss": { en: "Inches away.", es: "A centímetros.", fr: "À quelques centimètres." },
  save: { en: "What a stop.", es: "Qué parada.", fr: "Quel arrêt." },
  atmosphere: { en: "Nothing beats being there.", es: "Nada como vivirlo en el estadio.", fr: "Rien ne vaut d'y être." },
  "to-camera": { en: "Up close.", es: "De cerca.", fr: "De près." },
};

const REGION = new Intl.DisplayNames(["en"], { type: "region" });

/** Who the campaign speaks to; a global goal narrowed by a recovery to licensed markets names those markets. */
export function audienceOf(run: Pick<GoalRun, "club" | "objective" | "plan">, plan: Pick<GoalPlan, "territories"> = run.plan): string {
  const club = CLUBS[run.club].label;
  const o = run.objective;
  if (o.market) return `${club} supporters in ${marketsLabel(objectiveMarkets(o))}`;
  if (o.scope === "GLOBAL" && plan.territories.length < run.plan.territories.length) {
    return `${club} supporters in ${plan.territories.map((t) => REGION.of(t) ?? t).join(" and ")}`;
  }
  return o.scope === "GLOBAL" ? `${club} supporters worldwide` : `${club} supporters`;
}

/** Publication slot proposed for review: the next full hour + 1 h (same default as REROUTE's desk). */
export const proposedPublishAt = (now: Date) => new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000 + 3_600_000).toISOString();

/** The exact cut REROUTE evaluates: the TwelveLabs moment boundaries on the ScorePlay asset. */
export function editFor(runId: string, rec: Recommendation): EditPlan {
  const start = rec.candidate.startSeconds ?? 0;
  const end = rec.candidate.endSeconds ?? start + 15;
  return {
    id: `pulse-${runId}-${rec.candidate.scoreplayAssetId}@${start}-${end}`,
    title: `PULSE · ${rec.headline} · ${rec.candidate.title}`.slice(0, 140),
    segments: [{ scoreplayMediaId: rec.candidate.scoreplayAssetId, start, end, label: rec.matches[0]?.query ?? rec.headline }],
    derived: false,
  };
}

/** The edit a campaign version publishes: its derived cut when it has one, else the moment's own boundaries. */
export function campaignEdit(runId: string, rec: Recommendation, edl?: Edl): EditPlan {
  return edl ? edlToEditPlan(edl, `PULSE · ${rec.headline} · ${edl.sourceTitle} (edited cut)`.slice(0, 140)) : editFor(runId, rec);
}

/**
 * Every channel × territory of the plan, as REROUTE publish intents (club set for policy selection; a partner post
 * names the partner it promotes — a recovery that turns it organic drops it).
 */
export function intentsFor(plan: GoalPlan, rec: Recommendation, publishAt: string): PublishIntent[] {
  const competition = rec.candidate.competition ?? plan.competition;
  const target = plan.usage === "SPONSORED" && plan.targetSponsor ? { targetSponsor: plan.targetSponsor } : {};
  return plan.channels.flatMap((platform) =>
    plan.territories.map((territory) => ({ territory, platform, usage: plan.usage, competition, publishAt, club: plan.club, ...target })),
  );
}

export function buildGoalCampaign(input: {
  run: GoalRun;
  rec: Recommendation;
  campaignId: string;
  version: number;
  origin: GoalCampaign["origin"];
  /** The uses this version targets: the run's plan, or a REROUTE-remedied subset of it. */
  plan: GoalPlan;
  destination?: CommerceDestination;
  /** A derived cut of the moment (recovery TRIM / SAFE_SECTION): an edit plan, not a rendered file. */
  edl?: Edl;
  now: Date;
  previous?: GoalCampaign;
}): GoalCampaign {
  const { run, rec, now, previous, plan, edl } = input;
  const edit = campaignEdit(run.id, rec, edl);
  // Every version proposes a fresh slot (never a stale date from an earlier version); checks refresh it again.
  const intents = intentsFor(plan, rec, proposedPublishAt(now));
  const primary = rec.matches[0];
  const start = edl ? edl.retained[0].start : (rec.candidate.startSeconds ?? 0);
  const seconds = Math.round(edl ? edl.durationSec : (rec.candidate.endSeconds ?? 0) - (rec.candidate.startSeconds ?? 0));
  // Edited cuts quote tenths: whole-second rounding would put "0:15" inside a cut that starts at 0:14.5.
  const metadataOnly = rec.candidate.foundBy !== "TWELVELABS";
  const cut = edl
    ? `an edited ${edl.durationSec.toFixed(1)}-second cut (${edl.retained.map((r) => `${timecode(r.start)}–${timecode(r.end)}`).join(" + ")})`
    : metadataOnly
      ? `the whole ${seconds}-second clip`
      : `the ${seconds}-second moment at ${clock(start)}`;
  const organic = plan.usage === "ORGANIC" || plan.usage === "EDITORIAL";
  const draft = composeCampaign({
    id: input.campaignId,
    ownerId: run.id,
    club: run.club,
    objective: run.objective,
    candidate: rec.candidate,
    reroute: { edit, intent: intents[0] },
    // A ScorePlay player tag gives a name — the same in every language, and no claim about what the footage shows.
    hooks: primary.intent === "scoreplay:player" ? Object.fromEntries(LanguageSchema.options.map((l) => [l, `${rec.headline}.`])) : (HOOKS[primary.intent] ?? {}),
    fallbackHook: rec.headline,
    angle: `${rec.headline}: ${cut} in “${rec.candidate.title}”, as a vertical social cut for ${plan.channels.length} channels.`,
    cohort: audienceOf(run, plan),
    rationale: [rec.why.opportunity, rec.why.media],
    evidenceLabels: [
      metadataOnly
        ? "Ranking: objective × ScorePlay tags — footage not visually analysed; no fan-signal or market data used"
        : "Ranking: objective × live TwelveLabs evidence — no fan-signal or market data used",
    ],
    destination: organic ? undefined : input.destination,
    ...(organic && run.plan.usage === "COMMERCIAL" ? { organicNote: "Posted as organic club content after a rights recovery: no store or ticketing link." } : {}),
    now,
    previous,
  });
  return { ...draft, campaignId: input.campaignId, version: input.version, key: rec.key, mediaRef: rec.media, plan, intents, origin: input.origin, ...(edl ? { edl } : {}) };
}
