import type { Asset, Evidence } from "@/lib/contracts";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";

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

type EligibleRow = {
  media_id: string;
  club_code: string | null;
  title: string | null;
  media_type: string | null;
  cdn_url: string | null;
  thumbnail_url: string | null;
  sponsors: string[] | null;
  brands_seen: string[] | null;
};

/** Cached TWELVE LABS / HUMAN evidence from Supabase for decide path. */
export async function loadSupabaseEvidence(mediaId: string): Promise<Evidence[]> {
  if (!supabaseConfigured()) return [];
  const { data, error } = await getSupabaseAdmin()
    .from("evidence")
    .select("scoreplay_media_id,start_sec,end_sec,observation,source,label,confidence,origin")
    .eq("scoreplay_media_id", mediaId);
  if (error || !data) return [];
  return (data as EvidenceRow[]).map((r) => ({
    scoreplayMediaId: r.scoreplay_media_id,
    start: r.start_sec ?? undefined,
    end: r.end_sec ?? undefined,
    observation: r.observation,
    source: (r.source === "HUMAN" || r.source === "SCOREPLAY" ? r.source : "TWELVELABS") as Evidence["source"],
    label: r.label ?? undefined,
    confidence: r.confidence ?? undefined,
    origin: (r.origin === "LIVE" || r.origin === "CACHED" || r.origin === "HUMAN" ? r.origin : "CACHED") as Evidence["origin"],
  }));
}

export async function loadEligibleAsset(mediaId: string): Promise<Asset | null> {
  if (!supabaseConfigured()) return null;
  const { data, error } = await getSupabaseAdmin()
    .from("eligible_media")
    .select("media_id,club_code,title,media_type,cdn_url,thumbnail_url,sponsors,brands_seen")
    .eq("media_id", mediaId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as EligibleRow;
  const mt = (row.media_type || "").toLowerCase();
  const kind = mt.includes("video") ? "video" : mt.includes("image") || mt.includes("photo") ? "image" : "other";
  return {
    id: row.media_id,
    title: row.title || row.media_id,
    kind,
    thumbnailUrl: row.thumbnail_url ?? undefined,
    previewUrl: row.cdn_url ?? undefined,
    tags: [...(row.sponsors ?? []), ...(row.brands_seen ?? []).map((b) => `brand:${b}`)],
    facts: {
      sponsors: row.sponsors?.length ? row.sponsors : undefined,
      competition: row.club_code === "TOT" ? "Premier League" : row.club_code === "SAS" ? "NBA" : undefined,
      team: row.club_code === "TOT" ? "Tottenham Hotspur" : row.club_code === "SAS" ? "San Antonio Spurs" : undefined,
    },
    metadata: { source: "eligible_media", club_code: row.club_code },
    origin: "CACHED",
  };
}
