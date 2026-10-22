import { connection } from "next/server";
import { z } from "zod";
import type { AssetsResponseSchema } from "@/lib/contracts";
import { getScorePlayClient } from "@/lib/scoreplay";
import { getSession } from "@/lib/server/auth";
import { parseInput, route } from "@/lib/server/http";

const QuerySchema = z.object({
  q: z.string().default(""),
  limit: z.coerce.number().int().min(1).max(100).default(24),
});

/** GET /api/assets?q=&limit= — ScorePlay asset search. Authorized preview URLs only for a reviewer session. */
export const GET = route(async (req: Request) => {
  await connection();
  const params = new URL(req.url).searchParams;
  const { q, limit } = parseInput(QuerySchema, {
    q: params.get("q") ?? undefined,
    limit: params.get("limit") ?? undefined,
  });
  const [assets, session] = await Promise.all([getScorePlayClient().searchAssets(q, limit), getSession(req)]);
  const visible = session ? assets : assets.map(({ previewUrl: _hidden, ...asset }) => asset);
  return Response.json({ assets: visible } satisfies z.infer<typeof AssetsResponseSchema>);
});
