import { DecideRequestSchema, type EditDecision } from "@/lib/contracts";
import { decideEdit } from "@/lib/server/decide";
import { parseBody, route } from "@/lib/server/http";

/** POST /api/decide — deterministic verdict for an edit + intent (no Databricks, no video processing). */
export const POST = route(async (req: Request) => {
  const { edit, intent } = await parseBody(req, DecideRequestSchema);
  const result: EditDecision = await decideEdit(edit, intent);
  return Response.json(result);
});
