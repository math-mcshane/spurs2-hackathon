import { connection, type NextRequest } from "next/server";
import { route } from "@/lib/server/http";
import { getReceipt, listReceiptAudit } from "@/lib/server/store";

/** GET /api/receipts/[id] → RightsReceipt + `reviews` trail + `audit` (hash-chained events for this receipt). */
export const GET = route(async (_req: NextRequest, ctx: RouteContext<"/api/receipts/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const [receipt, audit] = await Promise.all([getReceipt(id), listReceiptAudit(id)]);
  return Response.json({ ...receipt, audit });
});
