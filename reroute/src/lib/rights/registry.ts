import { AppError } from "@/lib/errors";
import { PolicySchema, type Policy } from "./policy";
import demoSpursFrSponsored from "./policies/demo-spurs-fr-sponsored.json";
import demoTottenhamPl from "./policies/demo-tottenham-pl.json";

/** Bundled policies, validated once at module load (invalid JSON fails fast). Selection: `select.ts`. */
export const BUNDLED_POLICIES: readonly Policy[] = [demoSpursFrSponsored, demoTottenhamPl].map((raw) => PolicySchema.parse(raw));

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

/** A bundled policy by id (explicit lookups only — decisions always go through `selectPolicy`). */
export function loadPolicy(id: string): Policy {
  const policy = BUNDLED_POLICIES.find((p) => p.id === id);
  if (!policy) {
    throw new AppError("NOT_FOUND", `Unknown rights policy "${id}". Available: ${BUNDLED_POLICIES.map((p) => p.id).join(", ")}`);
  }
  return policy;
}

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
