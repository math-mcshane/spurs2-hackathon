import { CLUBS, type Sport } from "./clubs";
import { ChannelSchema, type Club, type GoalIntent, type GoalPlan, type GoalUsage, type ParsedObjective, type Product } from "./types";

/**
 * What footage serves a business objective. Each product maps to a few visual intents, each a
 * TwelveLabs Marengo query with a weight (how directly it serves the objective) and the reason shown
 * to the user. These are search *questions*, not answers: the moments come from the live index, and
 * a different objective asks different questions of the same library. Hackathon heuristics, editable.
 *
 * Labels and reasons never say whose shirt, fans or player is on screen: Marengo cannot verify a
 * club, and ScorePlay carries no verified player→team data for this footage.
 */

type IntentKey =
  | "kit"
  | "celebration"
  | "fans-colours"
  | "player-fan-bond"
  | "score"
  | "near-miss"
  | "save"
  | "atmosphere"
  | "to-camera"
  | "partner-on-kit";

const PHRASES: Record<IntentKey, { label: string; why: string; query: Record<Sport, string> }> = {
  kit: {
    label: "Shirt close-up",
    why: "It puts a match shirt and crest on screen — check whose shirt it is before it sells merchandise (team not verified)",
    query: {
      football: "close-up of a player's shirt with the crest visible",
      basketball: "close-up of a player's jersey with the logo visible",
    },
  },
  celebration: {
    label: "Celebration",
    why: "Peak emotion is the moment supporters most want to relive and share",
    query: { football: "players celebrating a goal together", basketball: "players celebrating a basket together" },
  },
  "fans-colours": {
    label: "Supporters in colours",
    why: "It shows supporters wearing team colours — the buyer, in the product (which club's supporters is not verified)",
    query: {
      football: "fans in the stands celebrating in football shirts and scarves",
      basketball: "fans in the arena cheering in team jerseys",
    },
  },
  "player-fan-bond": {
    label: "Players and fans together",
    why: "The player–supporter bond is what club merchandise sells",
    query: {
      football: "players applauding the travelling fans after the match",
      basketball: "players high-fiving fans courtside after the game",
    },
  },
  score: {
    label: "Goal",
    why: "Scoring moments are the most shared clips in any match",
    query: { football: "a goal being scored", basketball: "a dunk or three-pointer being scored" },
  },
  "near-miss": {
    label: "Big chance",
    why: "Near misses drive reactions and comments",
    query: { football: "player shooting just over the crossbar", basketball: "a last-second shot just missing" },
  },
  save: {
    label: "Big save",
    why: "A decisive save is a high-reaction, replayable moment",
    query: { football: "goalkeeper making a save", basketball: "a player blocking a shot" },
  },
  atmosphere: {
    label: "Stadium atmosphere",
    why: "The matchday atmosphere travels well with audiences who were not there",
    query: { football: "fans singing in the stadium before kick-off", basketball: "the arena crowd cheering before tip-off" },
  },
  "to-camera": {
    label: "Player to camera",
    why: "Direct-to-camera moments build a personal connection with the audience",
    query: { football: "player looking at the camera and smiling", basketball: "player looking at the camera and smiling" },
  },
  "partner-on-kit": {
    label: "Partner on the kit",
    why: "A sponsor activation needs the partner on screen — a scorer's shirt is the club's most-seen sponsor surface (which brands are actually visible is checked in the rights step)",
    query: {
      football: "player celebrating a goal with the sponsor logo on his shirt clearly visible",
      basketball: "player celebrating with the sponsor logo on his jersey clearly visible",
    },
  },
};

/** Intents and weights per objective product; `default` when the objective names no product. */
const PLAN: Record<Product | "default", [IntentKey, number][]> = {
  merch: [["kit", 1], ["fans-colours", 0.9], ["player-fan-bond", 0.8], ["celebration", 0.6]],
  jersey: [["kit", 1], ["celebration", 0.8], ["fans-colours", 0.7], ["to-camera", 0.5]],
  tickets: [["atmosphere", 1], ["fans-colours", 0.9], ["player-fan-bond", 0.8], ["celebration", 0.6]],
  engagement: [["score", 1], ["near-miss", 0.8], ["save", 0.7], ["celebration", 0.6], ["atmosphere", 0.4]],
  followers: [["score", 1], ["celebration", 0.8], ["to-camera", 0.7], ["near-miss", 0.5]],
  subscriptions: [["score", 1], ["near-miss", 0.8], ["save", 0.7], ["celebration", 0.6]],
  sponsor: [["partner-on-kit", 1], ["celebration", 0.9], ["atmosphere", 0.8], ["player-fan-bond", 0.6]],
  default: [["score", 1], ["celebration", 0.9], ["near-miss", 0.6], ["atmosphere", 0.5]],
};

export function goalIntents(objective: ParsedObjective, sport: Sport): GoalIntent[] {
  return PLAN[objective.product?.key ?? "default"].map(([key, weight]) => ({
    key,
    label: PHRASES[key].label,
    query: PHRASES[key].query[sport],
    weight,
    why: PHRASES[key].why,
  }));
}

/**
 * A GLOBAL objective is checked in each of these territories separately (REROUTE licences are per
 * territory; there is no "worldwide" verdict): the club's home market plus the largest Premier League
 * social audiences we target — US, France, Spain, Germany, India, Nigeria. Edit here to change.
 */
export const GLOBAL_TERRITORIES = ["GB", "US", "FR", "ES", "DE", "IN", "NG"] as const;

/**
 * Objectives that sell something are commercial use; a sponsor activation is a partner post (SPONSORED);
 * reach/engagement objectives are editorial.
 */
const USAGE: Record<Product, GoalUsage> = {
  merch: "COMMERCIAL",
  jersey: "COMMERCIAL",
  tickets: "COMMERCIAL",
  subscriptions: "COMMERCIAL",
  sponsor: "SPONSORED",
  engagement: "EDITORIAL",
  followers: "EDITORIAL",
};

/**
 * What REROUTE will be asked: every proposed channel × territory, for the selected club's competition. A partner post
 * (SPONSORED) carries the partner the goal names, so the rules can say whether it is one.
 */
export function goalPlan(objective: ParsedObjective, club: Club): GoalPlan {
  const c = CLUBS[club];
  const usage: GoalUsage = objective.product ? USAGE[objective.product.key] : "EDITORIAL";
  const [territories, territoryBasis] =
    objective.scope === "MARKET" && objective.market
      ? [[objective.market.code], `${objective.market.label}, as stated in the objective (“${objective.market.matched}”).`]
      : objective.scope === "GLOBAL"
        ? [[...GLOBAL_TERRITORIES], `Global objective: checked separately in ${GLOBAL_TERRITORIES.join(", ")} (PULSE's documented global list).`]
        : [[c.editorialIntent.territory], `No market in the objective: the club's home territory (${c.editorialIntent.territory}).`];
  return {
    club,
    scope: objective.scope,
    territories,
    territoryBasis,
    usage,
    ...(usage === "SPONSORED" && objective.targetSponsor ? { targetSponsor: objective.targetSponsor } : {}),
    channels: [...ChannelSchema.options],
    competition: c.competition,
  };
}

/**
 * The fixture the user referred to ("… from the Manchester United game", "against Arsenal"), as
 * written. MediaMapping's search restricts the footage to videos naming it (tags/filename) or reports
 * that it was not found.
 */
export function parseMatch(raw: string): string | undefined {
  const text = raw.replace(/\s+/g, " ");
  const m =
    /\b(?:from|of|in)\s+the\s+(.+?)\s+(?:match|game|fixture)\b/i.exec(text) ??
    /\b(?:against|vs\.?|versus|v)\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})/.exec(text);
  const name = m?.[1].replace(/^(?:last|latest|recent|weekend'?s?)\s+/i, "").trim();
  return name && name.length <= 60 ? name : undefined;
}
