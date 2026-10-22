import { memoryRepositories } from "./memory";
import { setRepositoriesOverride } from "./registry";
import type { Repositories } from "./types";

/** Test seam: swap the persistence backend. Refuses to run outside vitest so production never falls back to memory. */

function assertTestRuntime(): void {
  if (!process.env.VITEST) throw new Error("repositories/testing is for vitest only");
}

/** Installs fresh in-memory repositories (also backing `lib/server/store.ts`) and returns them. */
export function useMemoryRepositoriesForTests(): Repositories {
  assertTestRuntime();
  const repos = memoryRepositories();
  setRepositoriesOverride(repos);
  return repos;
}

export function useRepositoriesForTests(repos: Repositories): void {
  assertTestRuntime();
  setRepositoriesOverride(repos);
}

/** Back to the production (Supabase) backend. */
export function resetRepositoriesForTests(): void {
  assertTestRuntime();
  setRepositoriesOverride(undefined);
}
