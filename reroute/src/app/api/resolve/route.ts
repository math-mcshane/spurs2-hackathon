import { ResolveRequestSchema } from "@/lib/contracts";
import { parseBody, route } from "@/lib/server/http";
import { resolve } from "@/lib/server/resolver";

/** POST /api/resolve — blocker classification + (for CLIP blockers) Marengo alternatives, each re-checked. */
export const POST = route(async (req: Request) => {
  const input = await parseBody(req, ResolveRequestSchema);
  return Response.json(await resolve(input));
});
