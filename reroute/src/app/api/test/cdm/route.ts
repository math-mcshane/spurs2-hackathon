import { connection } from "next/server";
import { route } from "@/lib/server/http";
import { assertTestAccess } from "@/lib/server/test-auth";
import { probeCdm } from "@/lib/server/integration-probes";

/**
 * GET /api/test/cdm — end-to-end CDM funnel health.
 * inbound webhooks → Databricks L1/enrich sync → eligible_media/evidence → discover.
 */
export const GET = route(async (req: Request) => {
  await connection();
  assertTestAccess(req);
  return Response.json(await probeCdm());
});
