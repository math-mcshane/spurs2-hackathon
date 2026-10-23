import { connection } from "next/server";
import { z } from "zod";
import { ClubCodeSchema, DiscoverResponseSchema } from "@/lib/contracts";
import { discoverPartners } from "@/lib/discover/service";
import { parseInput, route } from "@/lib/server/http";

const QuerySchema = z.object({
  q: z.string().default(""),
  club: ClubCodeSchema.optional(),
  limit: z.coerce.number().int().min(1).max(24).default(12),
});

/** GET /api/discover?q=&club=SAS|TOT — partner-aware search over Supabase eligible_media. */
export const GET = route(async (req: Request) => {
  await connection();
  const params = new URL(req.url).searchParams;
  const { q, club, limit } = parseInput(QuerySchema, {
    q: params.get("q") ?? undefined,
    club: params.get("club") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  const result = await discoverPartners({ q, clubCode: club, limit });
  return Response.json(DiscoverResponseSchema.parse(result));
});
