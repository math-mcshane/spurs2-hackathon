import { connection } from "next/server";
import { route } from "@/lib/server/http";
import { assertTestAccess } from "@/lib/server/test-auth";
import { probeDatabricks } from "@/lib/server/integration-probes";

/** GET /api/test/databricks — compliance job configured + latest run (read-only). */
export const GET = route(async (req: Request) => {
  await connection();
  assertTestAccess(req);
  return Response.json(await probeDatabricks());
});
