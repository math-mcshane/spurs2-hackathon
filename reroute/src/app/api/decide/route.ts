import { DecideRequestSchema } from "@/lib/contracts";
import { decideEdit } from "@/lib/server/decide";
import { parseBody, route } from "@/lib/server/http";

/** POST /api/decide — deterministic verdict for an edit + intent; policy selected per asset + intent. */
export const POST = route(async (req: Request) => {
  const { edit, intent } = await parseBody(req, DecideRequestSchema);
  return Response.json(await decideEdit(edit, intent));
});
