import { z } from "zod";
import { selectWorkspaceDefault } from "@/lib/rights/packages";
import { requireReviewer } from "@/lib/server/auth";
import { parseBody, route } from "@/lib/server/http";
import { clientAddress, consumeRateLimit } from "@/lib/server/rate-limit";
import { POLICY_WRITE_LIMIT } from "../limits";

const SelectSchema = z.object({ club: z.string().trim().min(1).max(40), packageId: z.string().trim().min(1).max(200) });

/**
 * POST /api/policies/select { club, packageId } — signed-in reviewer sets the club's workspace default package
 * → { selection: { club, packageId, packageVersion, selectedBy, selectedAt } }. Audit event POLICY_SELECTED.
 */
export const POST = route(async (req: Request) => {
  const { reviewer } = await requireReviewer(req);
  consumeRateLimit(POLICY_WRITE_LIMIT, clientAddress(req));
  const { club, packageId } = await parseBody(req, SelectSchema);
  return Response.json({ selection: await selectWorkspaceDefault({ club, packageId, selectedBy: reviewer }) });
});
