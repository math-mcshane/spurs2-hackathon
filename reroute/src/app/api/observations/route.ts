import { connection } from "next/server";
import { z } from "zod";
import { EvidenceSchema } from "@/lib/contracts";
import { requireReviewer } from "@/lib/server/auth";
import { parseBody, parseInput, route } from "@/lib/server/http";
import { addHumanObservation, listHumanObservations } from "@/lib/server/store";

const HumanObservationSchema = EvidenceSchema.refine(
  (e) => e.start === undefined || e.end === undefined || e.start < e.end,
  { message: "start must be before end", path: ["end"] },
).refine((e) => e.observation.trim().length > 0, { message: "observation is required", path: ["observation"] });

/** POST /api/observations — signed-in reviewer records a HUMAN timecoded observation (source/origin forced to HUMAN). */
export const POST = route(async (req: Request) => {
  const { reviewer } = await requireReviewer(req);
  const evidence = await parseBody(req, HumanObservationSchema);
  return Response.json({ evidence: await addHumanObservation(evidence, reviewer) }, { status: 201 });
});

/** GET /api/observations?mediaId= → { evidence } (HUMAN observations only). */
export const GET = route(async (req: Request) => {
  await connection();
  const { mediaId } = parseInput(z.object({ mediaId: z.string().min(1) }), {
    mediaId: new URL(req.url).searchParams.get("mediaId") ?? undefined,
  });
  return Response.json({ evidence: await listHumanObservations(mediaId) });
});
