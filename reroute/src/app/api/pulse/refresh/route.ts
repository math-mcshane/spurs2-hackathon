import { boardRoute } from "@/features/pulse/server/http";
import { listOpportunities, refresh } from "@/features/pulse/server/service";
import { RefreshRequestSchema } from "@/features/pulse/types";
import { parseBody } from "@/lib/server/http";

/**
 * POST /api/pulse/refresh — rebuild from fixture/manual signals. Body `{ manual? }` adds a producer
 * trigger; `{ objective: "…" }` sets the active business objective, `{ objective: null }` clears it.
 */
export const POST = boardRoute(async (req) => {
  await refresh(await parseBody(req, RefreshRequestSchema));
  return Response.json(await listOpportunities());
});
