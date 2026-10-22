import { connection } from "next/server";
import { z } from "zod";
import type { AssetsResponseSchema } from "@/lib/contracts";
import { getScorePlayClient } from "@/lib/scoreplay";
import { parseInput, route } from "@/lib/server/http";

const QuerySchema = z.object({
  q: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

/** GET /api/assets?q=&limit= — ScorePlay asset search. */
export const GET = route(async (req: Request) => {
  await connection();
  const params = new URL(req.url).searchParams;
  const { q, limit } = parseInput(QuerySchema, {
    q: params.get("q") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  const assets = await getScorePlayClient().searchAssets(q, limit);
  return Response.json({ assets } satisfies z.infer<typeof AssetsResponseSchema>);
});
