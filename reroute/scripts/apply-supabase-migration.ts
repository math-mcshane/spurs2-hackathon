/**
 * Apply REROUTE Supabase migrations to the project in SUPABASE_URL.
 *
 * Usage (from reroute/):
 *   pnpm exec tsx --env-file=../andres/.env scripts/apply-supabase-migration.ts
 *   pnpm exec tsx --env-file=.env.local scripts/apply-supabase-migration.ts
 *
 * Prefers SUPABASE_DB_URL / DATABASE_URL (Postgres). Falls back to Management API
 * when SUPABASE_ACCESS_TOKEN is set.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "..", "supabase", "migrations");

function projectRefFromUrl(url: string): string {
  const host = new URL(url).hostname; // <ref>.supabase.co
  const ref = host.split(".")[0];
  if (!ref) throw new Error(`Cannot parse project ref from SUPABASE_URL=${url}`);
  return ref;
}

async function applyViaPostgres(dbUrl: string, sql: string, name: string) {
  const { default: postgres } = await import("postgres");
  const sqlClient = postgres(dbUrl, { max: 1, prepare: false });
  try {
    await sqlClient.unsafe(sql);
    console.log(`[ok] ${name} via DATABASE_URL`);
  } finally {
    await sqlClient.end({ timeout: 5 });
  }
}

async function applyViaManagementApi(ref: string, token: string, sql: string, name: string) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Management API ${res.status} for ${name}: ${text.slice(0, 500)}`);
  }
  console.log(`[ok] ${name} via Management API`);
}

function buildDbUrlFromPassword(ref: string, password: string): string {
  const encoded = encodeURIComponent(password);
  // Direct DB host (session mode). Prefer SUPABASE_DB_URL if pooler region differs.
  return `postgresql://postgres:${encoded}@db.${ref}.supabase.co:5432/postgres`;
}

async function main() {
  const url = process.env.SUPABASE_URL?.trim();
  if (!url) throw new Error("SUPABASE_URL is required");

  const ref = projectRefFromUrl(url);
  const password = process.env.SUPABASE_DB_PASSWORD?.trim();
  const dbUrl =
    process.env.SUPABASE_DB_URL?.trim() ||
    process.env.DATABASE_URL?.trim() ||
    (password ? buildDbUrlFromPassword(ref, password) : undefined);
  const accessToken = process.env.SUPABASE_ACCESS_TOKEN?.trim();

  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (!files.length) throw new Error(`No migrations in ${MIGRATIONS_DIR}`);

  console.log(`Project ref: ${ref}`);
  console.log(`Migrations: ${files.join(", ")}`);

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf8");
    if (dbUrl) {
      await applyViaPostgres(dbUrl, sql, file);
    } else if (accessToken) {
      await applyViaManagementApi(ref, accessToken, sql, file);
    } else {
      const sqlEditor = `https://supabase.com/dashboard/project/${ref}/sql/new`;
      const dbSettings = `https://supabase.com/dashboard/project/${ref}/settings/database`;
      throw new Error(
        [
          "Migration blocked: SUPABASE_SECRET_KEY cannot run DDL (CREATE TABLE).",
          "",
          "Fix (pick one), then re-run pnpm db:migrate:",
          "",
          "1) Add database password to ../andres/.env:",
          "     SUPABASE_DB_PASSWORD=<from Project Settings → Database>",
          `     ${dbSettings}`,
          "",
          "2) Or paste this SQL into the SQL Editor and click Run:",
          `     ${sqlEditor}`,
          `     File: supabase/migrations/${files[0]}`,
          "",
          "3) Or set SUPABASE_DB_URL / SUPABASE_ACCESS_TOKEN.",
        ].join("\n"),
      );
    }
  }

  console.log("Done. Browse tables: scoreplay_webhook_events, scoreplay_inbound_media");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
