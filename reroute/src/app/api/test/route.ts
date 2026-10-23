import { connection } from "next/server";
import { route } from "@/lib/server/http";
import { assertTestAccess } from "@/lib/server/test-auth";
import { envSnapshot, runAllProbes } from "@/lib/server/integration-probes";

/**
 * GET /api/test — integration probe index.
 * `?run=1` executes all probes (ScorePlay, TwelveLabs, Supabase, Databricks, CDM funnel).
 */
export const GET = route(async (req: Request) => {
  await connection();
  assertTestAccess(req);

  const url = new URL(req.url);
  const run = url.searchParams.get("run") === "1" || url.searchParams.get("run") === "true";

  const catalog = {
    purpose: "Public read-only probes for REROUTE ↔ ScorePlay / TwelveLabs / Supabase / Databricks CDM",
    auth: process.env.REROUTE_TEST_SECRET?.trim()
      ? "REROUTE_TEST_SECRET required (Bearer / X-Reroute-Test-Secret / ?token=)"
      : "open (set REROUTE_TEST_SECRET to lock). Vercel Deployment Protection may still apply.",
    endpoints: [
      { method: "GET", path: "/api/test", note: "this index; ?run=1 for all probes" },
      { method: "GET", path: "/api/test/scoreplay", note: "whoami" },
      { method: "GET", path: "/api/test/twelvelabs", note: "index describe" },
      { method: "GET", path: "/api/test/supabase", note: "CDM table counts" },
      { method: "GET", path: "/api/test/databricks", note: "job config + latest run" },
      { method: "GET", path: "/api/test/cdm", note: "funnel inbound→eligible→evidence→discover" },
      { method: "GET", path: "/api/eligible", note: "CDM mirror: L1-pass eligible_media" },
      { method: "GET", path: "/api/partners", note: "CDM mirror: partners + agreements" },
      { method: "GET", path: "/api/evidence?mediaId=", note: "CDM mirror: evidence rows" },
      { method: "GET", path: "/api/discover?q=&club=", note: "partner-aware discover" },
      { method: "GET", path: "/api/webhooks/scoreplay/inbound", note: "inbound media landings" },
    ],
    env: envSnapshot(),
  };

  if (!run) return Response.json(catalog);

  const results = await runAllProbes();
  return Response.json({ ...catalog, results });
});
