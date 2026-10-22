import { AppError } from "@/lib/errors";

export type TwelveLabsConfig = {
  apiKey: string;
  indexId: string;
  /** The env variable the key came from (per-club override, the shared key, or its legacy alias). */
  keyVariable: string;
  /** The env variable the index id came from (per-club override or the shared one). */
  indexVariable: string;
};

/** Thrown when a variable is missing; `missing` names it so callers can classify. */
export class TwelveLabsConfigError extends AppError {
  constructor(readonly missing: "API_KEY" | "INDEX_ID", message: string) {
    super("NOT_CONFIGURED", message);
    this.name = "TwelveLabsConfigError";
  }
}

const clubSuffix = (club: string): string => club.toUpperCase().replace(/[^A-Z0-9]+/g, "_");

/** `PULSE_TWELVELABS_INDEX_ID_<CLUB>` (club upper-cased, non-alphanumerics → `_`). */
export const clubIndexVariable = (club: string): string => `PULSE_TWELVELABS_INDEX_ID_${clubSuffix(club)}`;

/** `PULSE_TWELVELABS_API_KEY_<CLUB>`: the club's index lives in another TwelveLabs account. */
export const clubKeyVariable = (club: string): string => `PULSE_TWELVELABS_API_KEY_${clubSuffix(club)}`;

/**
 * The one TwelveLabs config reader. Key: the club's own `PULSE_TWELVELABS_API_KEY_<CLUB>` when set, else
 * `TWELVELABS_API_KEY`, else the legacy `TWELVE_LABS_API_KEY`. Index: the club's own index when
 * configured, else `TWELVELABS_INDEX_ID` (only required then).
 */
export function readTwelveLabsConfig(opts: { club?: string; env?: Record<string, string | undefined> } = {}): TwelveLabsConfig {
  const env = opts.env ?? process.env;
  const keyVariable = [opts.club ? clubKeyVariable(opts.club) : undefined, "TWELVELABS_API_KEY", "TWELVE_LABS_API_KEY"].find((v) => v && env[v]?.trim());
  if (!keyVariable) throw new TwelveLabsConfigError("API_KEY", "TwelveLabs not configured: TWELVELABS_API_KEY is not set");
  const apiKey = env[keyVariable]!.trim();
  const clubVariable = opts.club ? clubIndexVariable(opts.club) : undefined;
  const own = clubVariable ? env[clubVariable]?.trim() : undefined;
  const indexVariable = own ? clubVariable! : "TWELVELABS_INDEX_ID";
  const indexId = own || env.TWELVELABS_INDEX_ID?.trim();
  if (!indexId) {
    throw new TwelveLabsConfigError("INDEX_ID", `TwelveLabs not configured: ${clubVariable ? `${clubVariable} and ` : ""}TWELVELABS_INDEX_ID not set`);
  }
  return { apiKey, indexId, keyVariable, indexVariable };
}
