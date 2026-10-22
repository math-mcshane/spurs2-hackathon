import { AppError } from "@/lib/errors";

export type TwelveLabsConfig = {
  apiKey: string;
  indexId: string;
  keyVariable: "TWELVELABS_API_KEY" | "TWELVE_LABS_API_KEY";
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

/** `PULSE_TWELVELABS_INDEX_ID_<CLUB>` (club upper-cased, non-alphanumerics → `_`). */
export const clubIndexVariable = (club: string): string => `PULSE_TWELVELABS_INDEX_ID_${club.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}`;

/**
 * The one TwelveLabs config reader. Key: `TWELVELABS_API_KEY`, else the legacy `TWELVE_LABS_API_KEY`.
 * Index: the club's own index when configured, else `TWELVELABS_INDEX_ID` (only required then).
 */
export function readTwelveLabsConfig(opts: { club?: string; env?: Record<string, string | undefined> } = {}): TwelveLabsConfig {
  const env = opts.env ?? process.env;
  const canonical = env.TWELVELABS_API_KEY?.trim();
  const apiKey = canonical || env.TWELVE_LABS_API_KEY?.trim();
  if (!apiKey) throw new TwelveLabsConfigError("API_KEY", "TwelveLabs not configured: TWELVELABS_API_KEY is not set");
  const clubVariable = opts.club ? clubIndexVariable(opts.club) : undefined;
  const own = clubVariable ? env[clubVariable]?.trim() : undefined;
  const indexVariable = own ? clubVariable! : "TWELVELABS_INDEX_ID";
  const indexId = own || env.TWELVELABS_INDEX_ID?.trim();
  if (!indexId) {
    throw new TwelveLabsConfigError("INDEX_ID", `TwelveLabs not configured: ${clubVariable ? `${clubVariable} and ` : ""}TWELVELABS_INDEX_ID not set`);
  }
  return { apiKey, indexId, keyVariable: canonical ? "TWELVELABS_API_KEY" : "TWELVE_LABS_API_KEY", indexVariable };
}
