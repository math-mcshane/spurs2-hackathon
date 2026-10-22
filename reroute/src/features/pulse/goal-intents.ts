import type { Sport } from "./clubs";
import type { GoalIntent, ParsedObjective, Product } from "./types";

/**
 * What footage serves a business objective. Each product maps to a few visual intents, each a
 * TwelveLabs Marengo query with a weight (how directly it serves the objective) and the reason shown
 * to the user. These are search *questions*, not answers: the moments come from the live index, and
 * a different objective asks different questions of the same library. Hackathon heuristics, editable.
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
  | "to-camera";

const PHRASES: Record<IntentKey, { label: string; why: string; query: Record<Sport, string> }> = {
  kit: {
    label: "Player in the shirt",
    why: "It puts the club shirt — the product — on screen, worn by a player",
    query: {
      football: "close-up of a player wearing the club shirt with the crest visible",
      basketball: "close-up of a player wearing the team jersey with the logo visible",
    },
  },
  celebration: {
    label: "Celebration",
    why: "Peak emotion is when fans most want to wear the colours and share the moment",
    query: { football: "players celebrating a goal together", basketball: "players celebrating a basket together" },
  },
  "fans-colours": {
    label: "Fans in club colours",
    why: "It shows supporters wearing club merchandise — the buyer, in the product",
    query: {
      football: "fans in the away end celebrating in club shirts and scarves",
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
    why: "The matchday atmosphere is what a ticket buys",
    query: { football: "fans singing in the stadium before kick-off", basketball: "the arena crowd cheering before tip-off" },
  },
  "to-camera": {
    label: "Player to camera",
    why: "Direct-to-camera moments build a personal connection with the audience",
    query: { football: "player looking at the camera and smiling", basketball: "player looking at the camera and smiling" },
  },
};

/** Intents and weights per objective product; `default` when the objective names no product. */
const PLAN: Record<Product | "default", [IntentKey, number][]> = {
  merch: [["kit", 1], ["celebration", 0.9], ["fans-colours", 0.85], ["player-fan-bond", 0.6]],
  jersey: [["kit", 1], ["celebration", 0.8], ["fans-colours", 0.7], ["to-camera", 0.5]],
  tickets: [["atmosphere", 1], ["fans-colours", 0.9], ["player-fan-bond", 0.8], ["celebration", 0.6]],
  engagement: [["score", 1], ["celebration", 0.9], ["near-miss", 0.7], ["save", 0.7], ["atmosphere", 0.4]],
  followers: [["score", 1], ["celebration", 0.8], ["to-camera", 0.7], ["near-miss", 0.5]],
  subscriptions: [["score", 1], ["near-miss", 0.8], ["save", 0.7], ["celebration", 0.6]],
  sponsor: [["celebration", 0.9], ["atmosphere", 0.8], ["player-fan-bond", 0.6]],
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
 * The fixture the user referred to ("… from the Manchester United match", "against Arsenal"), as
 * written. Presentation and season context only — footage is never filtered by filename words.
 */
export function parseMatch(raw: string): string | undefined {
  const text = raw.replace(/\s+/g, " ");
  const m =
    /\b(?:from|of|in)\s+the\s+(.+?)\s+(?:match|game|fixture)\b/i.exec(text) ??
    /\b(?:against|vs\.?|versus|v)\s+([A-Z][\w'.-]*(?:\s+[A-Z][\w'.-]*){0,3})/.exec(text);
  const name = m?.[1].replace(/^(?:last|latest|recent|weekend'?s?)\s+/i, "").trim();
  return name && name.length <= 60 ? name : undefined;
}
