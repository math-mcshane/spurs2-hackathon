import { connection, type NextRequest } from "next/server";
import { getSession } from "@/lib/server/auth";
import { DecisionContext, defaultDeps } from "@/lib/server/context";
import { route } from "@/lib/server/http";

/**
 * GET /api/assets/[id]?club= → { asset, observations, analysis, analysisDetail?, media?, notes }.
 * observations = TwelveLabs (LIVE/CACHED, via the MediaRef in `media`) merged with HUMAN. `analysis` says
 * whether machine analysis exists (UNLINKABLE = ScorePlay↔TwelveLabs identity not proven).
 * The authorized ScorePlay `previewUrl` is returned only to a reviewer session.
 */
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/assets/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const club = new URL(req.url).searchParams.get("club") ?? undefined;
  const decision = new DecisionContext(defaultDeps(club));
  const [session] = await Promise.all([getSession(req), decision.ensure([id])]);
  const { previewUrl: _hidden, ...withoutPreview } = decision.assets[id];
  const analysis = decision.analysis[id];
  return Response.json({
    asset: session ? decision.assets[id] : withoutPreview,
    observations: decision.observations[id],
    analysis: analysis.status,
    ...(analysis.status === "AVAILABLE" ? {} : { analysisDetail: analysis.detail }),
    ...(decision.media[id] ? { media: decision.media[id] } : {}),
    notes: decision.notes,
  });
});
