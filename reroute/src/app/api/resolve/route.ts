import type { z } from "zod";
import { ResolveRequestSchema, type ResolveResponseSchema } from "@/lib/contracts";
import { parseBody, route } from "@/lib/server/http";
import { resolve } from "@/lib/server/resolver";

/** POST /api/resolve — Marengo alternatives for one segment, each independently re-checked. */
export const POST = route(async (req: Request) => {
  const input = await parseBody(req, ResolveRequestSchema);
  const result = await resolve(input);
  return Response.json(result satisfies z.infer<typeof ResolveResponseSchema>);
});
