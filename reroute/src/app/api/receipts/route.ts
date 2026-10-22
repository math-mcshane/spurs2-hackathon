import { CreateReceiptRequestSchema } from "@/lib/contracts";
import { decideEdit } from "@/lib/server/decide";
import { parseBody, route } from "@/lib/server/http";
import { createReceipt } from "@/lib/server/store";

/** POST /api/receipts — receipt with a fresh server-side decision (+ the MediaRefs its evidence came from), review PENDING. */
export const POST = route(async (req: Request) => {
  const { edit, intent } = await parseBody(req, CreateReceiptRequestSchema);
  const { decision, media } = await decideEdit(edit, intent);
  return Response.json(await createReceipt({ edit, intent, decision, media }), { status: 201 });
});
