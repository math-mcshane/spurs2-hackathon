import { pulseRoute } from "@/features/pulse/server/http";
import { businessMetrics } from "@/features/pulse/server/service";

/** GET /api/pulse/business — fulfillment / pipeline / efficiency, each with data-quality labels. */
export const GET = pulseRoute(async () => Response.json(await businessMetrics()));
