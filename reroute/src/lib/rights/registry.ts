import { AppError } from "@/lib/errors";
import { PolicySchema, type Policy } from "./policy";
import demoSpursFrSponsored from "./policies/demo-spurs-fr-sponsored.json";
import demoTottenhamPl from "./policies/demo-tottenham-pl.json";

export const DEFAULT_POLICY_ID = "demo-spurs-fr-sponsored";

/** Bundled policies, validated once at module load (invalid JSON fails fast). */
const POLICIES: ReadonlyMap<string, Policy> = new Map(
  [demoSpursFrSponsored, demoTottenhamPl].map((raw) => {
    const policy = PolicySchema.parse(raw);
    return [policy.id, policy] as const;
  }),
);

export type PolicySummary = Pick<Policy, "id" | "version" | "fictional" | "source" | "disclaimer">;

/** Loads a bundled policy by id; defaults to env REROUTE_POLICY_ID, then the Spurs demo policy. */
export function loadPolicy(id?: string): Policy {
  const wanted = id ?? (process.env.REROUTE_POLICY_ID || DEFAULT_POLICY_ID);
  const policy = POLICIES.get(wanted);
  if (!policy) {
    throw new AppError("NOT_FOUND", `Unknown rights policy "${wanted}". Available: ${[...POLICIES.keys()].join(", ")}`);
  }
  return policy;
}

export function listPolicies(): PolicySummary[] {
  return [...POLICIES.values()].map(({ id, version, fictional, source, disclaimer }) => ({
    id,
    version,
    fictional,
    source,
    disclaimer,
  }));
}
