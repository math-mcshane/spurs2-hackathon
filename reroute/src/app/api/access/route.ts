import { AccessRequestSchema } from "@/lib/contracts";
import { checkAccess } from "@/lib/server/access";
import { parseBody, route } from "@/lib/server/http";

/** POST /api/access — server-side gate; re-evaluates, never trusts a client verdict. */
export const POST = route(async (req: Request) => {
  const { edit, intent, action } = await parseBody(req, AccessRequestSchema);
  return Response.json(await checkAccess(edit, intent, action));
});
