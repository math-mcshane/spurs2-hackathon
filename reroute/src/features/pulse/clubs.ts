import type { Usage } from "@/lib/contracts";
import type { Club } from "./types";

export type Sport = "football" | "basketball";

/**
 * Club context for the two hackathon datasets. `editorialIntent` is the REROUTE publish intent used
 * when an opportunity has no sponsor brief (organic club channels). `library` says where the club's
 * footage lives: ScorePlay team terms (resolved with `GET /tag/search`); the TwelveLabs index is
 * `PULSE_TWELVELABS_INDEX_ID_<CLUB>` when set, else `TWELVELABS_INDEX_ID` (lib/twelvelabs/config).
 */
export const CLUBS: Record<
  Club,
  {
    label: string;
    sport: Sport;
    competition: string;
    editorialIntent: { territory: string; platform: string; usage: Usage };
    library: { teamTerms: string[] };
    /** The club's own web domains: a producer-entered store/ticket link must be on one of these (or a subdomain). */
    domains: string[];
  }
> = {
  spurs: {
    label: "San Antonio Spurs",
    sport: "basketball",
    competition: "NBA",
    editorialIntent: { territory: "US", platform: "instagram", usage: "ORGANIC" },
    // ScorePlay tags the team "san antonio spurs (sas)"; a "San Antonio Spurs" search only returns photo credits.
    library: { teamTerms: ["SAS"] },
    domains: ["spurs.com", "nba.com"],
  },
  tottenham: {
    label: "Tottenham Hotspur",
    sport: "football",
    competition: "Premier League",
    editorialIntent: { territory: "GB", platform: "instagram", usage: "ORGANIC" },
    library: { teamTerms: ["Tottenham Hotspur"] },
    domains: ["tottenhamhotspur.com"],
  },
};
