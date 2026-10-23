import { connection, type NextRequest } from "next/server";
import { forMediaAccess, mediaAccess } from "@/lib/media/preview";
import { DecisionContext, defaultDeps } from "@/lib/server/context";
import { route } from "@/lib/server/http";

/**
 * GET /api/assets/[id]?club= → { asset, observations, analysis, analysisDetail?, media?, notes }.
 * observations = TwelveLabs (LIVE/CACHED, via the MediaRef in `media`) merged with HUMAN. `analysis` says
 * whether machine analysis exists (UNLINKABLE = ScorePlay↔TwelveLabs identity not proven).
 * Footage-derived URLs (`previewUrl`, `thumbnailUrl`, anywhere in the body) only when MEDIA_PREVIEW_ENABLED=true
 * AND the caller is a reviewer session.
 */
export const GET = route(async (req: NextRequest, ctx: RouteContext<"/api/assets/[id]">) => {
  await connection();
  const { id } = await ctx.params;
  const club = new URL(req.url).searchParams.get("club") ?? undefined;
  const decision = new DecisionContext(defaultDeps(club));
  const [access] = await Promise.all([mediaAccess(req), decision.ensure([id])]);
  const analysis = decision.analysis[id];
  return Response.json(
    forMediaAccess(access, {
      asset: decision.assets[id],
      observations: decision.observations[id],
      analysis: analysis.status,
      ...(analysis.status === "AVAILABLE" ? {} : { analysisDetail: analysis.detail }),
      ...(decision.media[id] ? { media: decision.media[id] } : {}),
      notes: decision.notes,
    }),
  );
});
