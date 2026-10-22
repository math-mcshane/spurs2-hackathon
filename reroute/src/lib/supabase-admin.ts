import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "@/lib/errors";

let client: SupabaseClient | undefined;

/**
 * Privileged Supabase client (secret key, bypasses RLS). Server routes only — never ship to the browser.
 * Env comes from the Vercel ↔ Supabase integration.
 */
export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new AppError("NOT_CONFIGURED", "Supabase not configured: set SUPABASE_URL and SUPABASE_SECRET_KEY");
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}
