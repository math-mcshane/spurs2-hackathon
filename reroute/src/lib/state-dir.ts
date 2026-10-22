import os from "node:os";
import path from "node:path";

/**
 * Root for local state (`.data/`, `.cache/`, `.renders/`). The project dir locally; on Vercel the
 * deployment filesystem is read-only, so `/tmp` — which is per-instance and EPHEMERAL there.
 */
export const STATE_ROOT = process.env.VERCEL ? path.join(os.tmpdir(), "reroute") : process.cwd();
