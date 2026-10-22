/**
 * Club-name identity shared by ScorePlay mapping and policy selection. ScorePlay names the same club
 * differently per surface ("Tottenham Hotspur" tag option, "Tottenham Hotspur FC" squad team,
 * "San Antonio Spurs (SAS)" team tag), so names are compared on a normalized key.
 */

/** Clubs recognized from plain (untyped) ScorePlay tag options. Typed `team` options are recognized regardless. */
export const KNOWN_CLUB_NAMES: readonly string[] = [
  "Tottenham Hotspur",
  "Manchester United",
  "San Antonio Spurs",
  "Sacramento Kings",
];

/** "Tottenham Hotspur FC" → "tottenham hotspur"; "San Antonio Spurs (SAS)" → "san antonio spurs". */
export function clubKey(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(fc|afc|cf)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const sameClub = (a: string, b: string): boolean => clubKey(a) !== "" && clubKey(a) === clubKey(b);

export const isKnownClub = (name: string): boolean => KNOWN_CLUB_NAMES.some((club) => sameClub(club, name));
