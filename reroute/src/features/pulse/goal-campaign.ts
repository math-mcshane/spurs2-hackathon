import { composeCampaign } from "./campaign-builder";
import { CLUBS } from "./clubs";
import { handoffToReroute, type RerouteInput } from "./handoff-to-reroute";
import { clock } from "./moment-ranking";
import type { CampaignDraft, CommerceDestination, GoalRun, Language, Recommendation } from "./types";

/**
 * Hooks per visual intent. They describe the *kind* of moment TwelveLabs matched, never facts it did
 * not establish (no scorer, minute, result, opponent or venue), so they stay true for any clip found.
 */
const HOOKS: Record<string, Partial<Record<Language, string>>> = {
  kit: { en: "Wear it like they do.", es: "Llévala como ellos.", fr: "Portez-le comme eux." },
  celebration: {
    en: "Moments like this are why we wear the colours.",
    es: "Momentos así son los que nos hacen llevar estos colores.",
    fr: "C'est pour des moments comme ça qu'on porte ces couleurs.",
  },
  "fans-colours": { en: "Our fans, in our colours.", es: "Nuestra afición, con nuestros colores.", fr: "Nos supporters, à nos couleurs." },
  "player-fan-bond": {
    en: "For the fans, from the players.",
    es: "Para la afición, de parte de los jugadores.",
    fr: "Pour les supporters, de la part des joueurs.",
  },
  score: { en: "Watch it again.", es: "Míralo otra vez.", fr: "À revoir." },
  "near-miss": { en: "Inches away.", es: "A centímetros.", fr: "À quelques centimètres." },
  save: { en: "What a stop.", es: "Qué parada.", fr: "Quel arrêt." },
  atmosphere: { en: "Nothing beats being there.", es: "Nada como vivirlo en el estadio.", fr: "Rien ne vaut d'y être." },
  "to-camera": { en: "Up close.", es: "De cerca.", fr: "De près." },
};

export function audienceOf(run: GoalRun): string {
  const club = CLUBS[run.club].label;
  const o = run.objective;
  return o.market ? `${club} fans in ${o.market.label}` : o.scope === "GLOBAL" ? `${club} fans worldwide` : `${club} fans`;
}

/**
 * The exact REROUTE request for one moment: the TwelveLabs cut, the club's organic channel and the
 * objective's market as territory. The same derivation is used for drafts, checks and alternatives.
 */
export function rerouteRequestFor(run: GoalRun, rec: Recommendation, now: Date): RerouteInput {
  return handoffToReroute(
    {
      opportunityId: run.id,
      club: run.club,
      creativeBrief: `${rec.headline} — ${run.objective.summary}`,
      targetAudience: audienceOf(run),
      desiredFormat: "vertical_short",
      mediaCandidates: [
        {
          scoreplayAssetId: rec.candidate.scoreplayAssetId,
          twelveLabsAssetId: rec.candidate.twelveLabsVideoId,
          startSeconds: rec.candidate.startSeconds,
          endSeconds: rec.candidate.endSeconds,
          durationSec: rec.candidate.durationSec,
          competition: rec.candidate.competition,
        },
      ],
      sourceEvidenceIds: [],
    },
    { territory: run.objective.market?.code, now },
  );
}

export function buildGoalCampaign(input: {
  run: GoalRun;
  rec: Recommendation;
  destination?: CommerceDestination;
  now: Date;
  previous?: CampaignDraft;
}): CampaignDraft {
  const { run, rec, now } = input;
  const { edit, intent } = rerouteRequestFor(run, rec, now);
  const primary = rec.matches[0];
  const seconds = Math.round((rec.candidate.endSeconds ?? 0) - (rec.candidate.startSeconds ?? 0));
  return composeCampaign({
    id: `cmp-${run.id}`,
    ownerId: run.id,
    club: run.club,
    objective: run.objective,
    candidate: rec.candidate,
    reroute: { edit, intent },
    hooks: HOOKS[primary.intent] ?? {},
    fallbackHook: rec.headline,
    angle: `${rec.headline}: the ${seconds}-second moment at ${clock(rec.candidate.startSeconds ?? 0)} in “${rec.candidate.title}”, as a vertical social cut.`,
    cohort: audienceOf(run),
    rationale: [rec.why.opportunity, rec.why.media],
    evidenceLabels: ["Ranking: objective × live video evidence — no fan-signal data used"],
    destination: input.destination,
    now,
    previous: input.previous,
  });
}
