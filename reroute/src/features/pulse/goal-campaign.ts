import type { EditPlan, PublishIntent } from "@/lib/contracts";
import { composeCampaign } from "./campaign-builder";
import { CLUBS } from "./clubs";
import { clock } from "./moment-ranking";
import type { CommerceDestination, GoalCampaign, GoalPlan, GoalRun, Language, Recommendation } from "./types";

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

export function audienceOf(run: Pick<GoalRun, "club" | "objective">): string {
  const club = CLUBS[run.club].label;
  const o = run.objective;
  return o.market ? `${club} supporters in ${o.market.label}` : o.scope === "GLOBAL" ? `${club} supporters worldwide` : `${club} supporters`;
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

/** Every channel × territory of the plan, as REROUTE publish intents (club set for policy selection). */
export function intentsFor(plan: GoalPlan, rec: Recommendation, publishAt: string): PublishIntent[] {
  const competition = rec.candidate.competition ?? plan.competition;
  return plan.channels.flatMap((platform) =>
    plan.territories.map((territory) => ({ territory, platform, usage: plan.usage, competition, publishAt, club: plan.club })),
  );
}

export function buildGoalCampaign(input: {
  run: GoalRun;
  rec: Recommendation;
  campaignId: string;
  version: number;
  origin: GoalCampaign["origin"];
  destination?: CommerceDestination;
  now: Date;
  previous?: GoalCampaign;
}): GoalCampaign {
  const { run, rec, now, previous } = input;
  const edit = editFor(run.id, rec);
  // The publication slot is fixed at the first proposal so every version is checked for the same date.
  const intents = intentsFor(run.plan, rec, previous?.intents[0]?.publishAt ?? proposedPublishAt(now));
  const primary = rec.matches[0];
  const seconds = Math.round((rec.candidate.endSeconds ?? 0) - (rec.candidate.startSeconds ?? 0));
  const draft = composeCampaign({
    id: input.campaignId,
    ownerId: run.id,
    club: run.club,
    objective: run.objective,
    candidate: rec.candidate,
    reroute: { edit, intent: intents[0] },
    hooks: HOOKS[primary.intent] ?? {},
    fallbackHook: rec.headline,
    angle: `${rec.headline}: the ${seconds}-second moment at ${clock(rec.candidate.startSeconds ?? 0)} in “${rec.candidate.title}”, as a vertical social cut for ${run.plan.channels.length} channels.`,
    cohort: audienceOf(run),
    rationale: [rec.why.opportunity, rec.why.media],
    evidenceLabels: ["Ranking: objective × live TwelveLabs evidence — no fan-signal or market data used"],
    destination: input.destination,
    now,
    previous,
  });
  return { ...draft, campaignId: input.campaignId, version: input.version, key: rec.key, mediaRef: rec.media, plan: run.plan, intents, origin: input.origin };
}
