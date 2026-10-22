import os from "node:os";
import path from "node:path";

/**
 * Root for local scratch state (`.cache/`, `.renders/`). The project dir locally; on Vercel the
 * deployment filesystem is read-only, so `/tmp` — per-instance and EPHEMERAL there.
 * Durable shared data (receipts, reviews, observations) lives in Supabase, not here.
 */
export const STATE_ROOT = process.env.VERCEL ? path.join(os.tmpdir(), "reroute") : process.cwd();
