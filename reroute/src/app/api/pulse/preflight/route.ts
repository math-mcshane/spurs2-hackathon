import { z } from "zod";
import { goalDeps } from "@/features/pulse/server/goal-service";
import { pulseRoute } from "@/features/pulse/server/http";
import { preflightOpportunity } from "@/features/pulse/server/preflight";
import { mediaAccess } from "@/lib/media/preview";
import { parseBody } from "@/lib/server/http";

const PreflightRequestSchema = z.object({ id: z.string().min(1).max(200), key: z.string().min(1).max(300) });

/**
 * POST /api/pulse/preflight `{ id, key }` → `{ preflight: OpportunityPreflight }`: REROUTE's selection-time verdict for
 * one recommended moment under the run's current plan and rule package. Read-only on the run (no version bump).
 */
export const POST = pulseRoute(async (req) => {
  const [body, media] = await Promise.all([parseBody(req, PreflightRequestSchema), mediaAccess(req)]);
  return Response.json({ preflight: await preflightOpportunity(body, goalDeps(media)) });
});
