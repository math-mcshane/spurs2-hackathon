import { connection, type NextRequest } from "next/server";
import { DecisionContext } from "@/lib/server/context";
import { route } from "@/lib/server/http";

/**
 * GET /api/assets/[id] → { asset, observations, analysis, analysisDetail? }.
 * observations = TwelveLabs (LIVE/CACHED) merged with HUMAN; `analysis` tells the UI whether
 * machine analysis exists (anything but AVAILABLE caps verdicts at NEEDS_REVIEW).
 */
export const GET = route(async (_req: NextRequest, ctx: RouteContext<"/api/assets/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const decision = new DecisionContext();
  await decision.ensure([id]);
  const analysis = decision.analysis[id];
  return Response.json({
    asset: decision.assets[id],
    observations: decision.observations[id],
    analysis: analysis.status,
    ...(analysis.status === "AVAILABLE" ? {} : { analysisDetail: analysis.detail }),
  });
});
