import { connection } from "next/server";
import { route } from "@/lib/server/http";
import { assertTestAccess } from "@/lib/server/test-auth";
import { probeScorePlay } from "@/lib/server/integration-probes";

/** GET /api/test/scoreplay — ScorePlay whoami probe. */
export const GET = route(async (req: Request) => {
  await connection();
  assertTestAccess(req);
  return Response.json(await probeScorePlay());
});
