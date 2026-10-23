import { AppError } from "@/lib/errors";
import { PolicySchema, type Policy } from "./policy";
import demoSpursFrSponsored from "./policies/demo-spurs-fr-sponsored.json";
import demoTottenhamCommercial from "./policies/demo-tottenham-commercial.json";
import demoTottenhamPl from "./policies/demo-tottenham-pl.json";
import tottenhamInternationalSample from "./policies/tottenham-international-window.sample.json";

/**
 * Every bundled preset package, validated once at module load (invalid JSON fails fast). Order matters: the
 * first preset of a club is that club's default package (`packages.ts`).
 */
export const PRESET_POLICIES: readonly Policy[] = [demoSpursFrSponsored, demoTottenhamPl, demoTottenhamCommercial].map((raw) =>
  PolicySchema.parse(raw),
);

/**
 * The default evaluation set: one preset per club (its first preset). Selection (`select.ts`) must never see
 * two packages for one club; a different package is chosen per run through `packages.ts`.
 */
export const BUNDLED_POLICIES: readonly Policy[] = PRESET_POLICIES.filter(
  (p, i) => PRESET_POLICIES.findIndex((q) => q.applicability.club === p.applicability.club) === i,
);

/** The Policy Center's downloadable upload sample ("Download sample"). Not a preset: it only enters the library by upload. */
export const SAMPLE_UPLOAD_POLICY: Policy = PolicySchema.parse(tottenhamInternationalSample);

export interface PolicySummary {
  id: string;
  version: string;
  title: string;
  kind: Policy["kind"];
  /** = kind === "DEMO" (kept for the UI banner). */
  fictional: boolean;
  club: string;
  competitions: string[];
  provenance?: string;
  validFrom: string;
  validUntil: string;
  source: string;
  disclaimer: string;
}

/** A bundled preset by id (explicit lookups only — decisions always go through `selectPolicy`). */
export function loadPolicy(id: string): Policy {
  const policy = PRESET_POLICIES.find((p) => p.id === id);
  if (!policy) {
    throw new AppError("NOT_FOUND", `Unknown rights policy "${id}". Available: ${PRESET_POLICIES.map((p) => p.id).join(", ")}`);
  }
  return policy;
}

/** Summaries of the default evaluation set (`BUNDLED_POLICIES`). The full library: `packages.ts`. */
export function listPolicies(): PolicySummary[] {
  return BUNDLED_POLICIES.map(({ id, version, title, kind, applicability: a, source, disclaimer }) => ({
    id,
    version,
    title,
    kind,
    fictional: kind === "DEMO",
    club: a.club,
    competitions: a.competitions,
    provenance: a.provenance?.description,
    validFrom: a.validFrom,
    validUntil: a.validUntil,
    source,
    disclaimer,
  }));
}
