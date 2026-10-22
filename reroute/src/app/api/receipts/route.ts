import { CreateReceiptRequestSchema } from "@/lib/contracts";
import { decideEdit } from "@/lib/server/decide";
import { parseBody, route } from "@/lib/server/http";
import { createReceipt } from "@/lib/server/store";

/** POST /api/receipts — receipt with a fresh server-side decision, review PENDING. */
export const POST = route(async (req: Request) => {
  const { edit, intent } = await parseBody(req, CreateReceiptRequestSchema);
  const { decision } = await decideEdit(edit, intent);
  return Response.json(await createReceipt({ edit, intent, decision }), { status: 201 });
});
