import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { supabaseRepositories } from "./supabase";
import type { Repositories } from "./types";

/** The one place the active backend is chosen: Supabase, unless a test installed an override via `testing.ts`. */

let supabase: Repositories | undefined;
let override: Repositories | undefined;

export function activeRepositories(): Repositories {
  return override ?? (supabase ??= supabaseRepositories(getSupabaseAdmin));
}

/** Only `testing.ts` calls this (it refuses to run outside vitest). */
export function setRepositoriesOverride(repos: Repositories | undefined): void {
  override = repos;
}
