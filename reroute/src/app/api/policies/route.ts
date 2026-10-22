import { connection } from "next/server";
import { listPolicies } from "@/lib/rights";
import { route } from "@/lib/server/http";

/**
 * GET /api/policies → { policies } with kind (VERIFIED/DEMO), club, competitions, provenance, term and
 * disclaimer. There is no global "active" policy: each decision selects one per asset + publish intent.
 */
export const GET = route(async () => {
  await connection();
  return Response.json({ policies: listPolicies() });
});
