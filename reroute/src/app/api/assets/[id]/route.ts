import { connection, type NextRequest } from "next/server";
import { DecisionContext, defaultDeps } from "@/lib/server/context";
import { route } from "@/lib/server/http";

/**
 * GET /api/assets/[id]?club= → { asset, observations, analysis, analysisDetail?, media?, notes }.
 * observations = TwelveLabs (LIVE/CACHED, via the MediaRef in `media`) merged with HUMAN. `analysis` says
 * whether machine analysis exists (UNLINKABLE = ScorePlay↔TwelveLabs identity not proven).
 */
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/assets/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const club = new URL(req.url).searchParams.get("club") ?? undefined;
  const decision = new DecisionContext(defaultDeps(club));
  await decision.ensure([id]);
  const analysis = decision.analysis[id];
  return Response.json({
    asset: decision.assets[id],
    observations: decision.observations[id],
    analysis: analysis.status,
    ...(analysis.status === "AVAILABLE" ? {} : { analysisDetail: analysis.detail }),
    ...(decision.media[id] ? { media: decision.media[id] } : {}),
    notes: decision.notes,
  });
});
