import type { Evidence } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

type EvidenceRow = {
  scoreplay_media_id: string;
  start_sec: number | null;
  end_sec: number | null;
  observation: string;
  source: string;
  label: string | null;
  confidence: number | null;
  origin: string | null;
};

function rowToEvidence(r: EvidenceRow): Evidence {
  return {
    scoreplayMediaId: r.scoreplay_media_id,
    start: r.start_sec ?? undefined,
    end: r.end_sec ?? undefined,
    observation: r.observation,
    source: "HUMAN",
    label: r.label ?? undefined,
    confidence: r.confidence ?? undefined,
    origin: "HUMAN",
  };
}

/** Persist HUMAN observation into public.evidence (CDM SoR). */
export async function addHumanObservationSb(evidence: Evidence): Promise<Evidence> {
  const stored: Evidence = { ...evidence, source: "HUMAN", origin: "HUMAN" };
  const { error } = await getSupabaseAdmin().from("evidence").insert({
    scoreplay_media_id: stored.scoreplayMediaId,
    start_sec: stored.start ?? null,
    end_sec: stored.end ?? null,
    observation: stored.observation,
    source: "HUMAN",
    label: stored.label ?? null,
    confidence: stored.confidence ?? null,
    origin: "HUMAN",
    evidence_json: {},
  });
  if (error) throw new AppError("UPSTREAM", error.message);
  return stored;
}

export async function listHumanObservationsSb(scoreplayMediaId: string): Promise<Evidence[]> {
  const { data, error } = await getSupabaseAdmin()
    .from("evidence")
    .select("scoreplay_media_id,start_sec,end_sec,observation,source,label,confidence,origin")
    .eq("scoreplay_media_id", scoreplayMediaId)
    .eq("source", "HUMAN")
    .order("observed_at", { ascending: true });
  if (error) throw new AppError("UPSTREAM", error.message);
  return ((data ?? []) as EvidenceRow[]).map(rowToEvidence);
}
