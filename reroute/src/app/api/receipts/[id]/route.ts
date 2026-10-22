import { connection, type NextRequest } from "next/server";
import { route } from "@/lib/server/http";
import { getReceipt } from "@/lib/server/store";

/** GET /api/receipts/[id] → RightsReceipt (+ `reviews` audit trail). */
export const GET = route(async (_req: NextRequest, ctx: RouteContext<"/api/receipts/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  return Response.json(await getReceipt(id));
});
