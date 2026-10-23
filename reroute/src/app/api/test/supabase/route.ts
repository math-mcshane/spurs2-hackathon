import { connection } from "next/server";
import { route } from "@/lib/server/http";
import { assertTestAccess } from "@/lib/server/test-auth";
import { probeSupabase } from "@/lib/server/integration-probes";

/** GET /api/test/supabase — CDM table counts (partners, eligible_media, evidence, inbound). */
export const GET = route(async (req: Request) => {
  await connection();
  assertTestAccess(req);
  return Response.json(await probeSupabase());
});
