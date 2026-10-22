import { connection } from "next/server";
import { listPolicies, loadPolicy } from "@/lib/rights";
import { route } from "@/lib/server/http";

/** GET /api/policies → { policies, activeId } (each with fictional flag + disclaimer for the UI banner). */
export const GET = route(async () => {
  await connection();
  return Response.json({ policies: listPolicies(), activeId: loadPolicy().id });
});
