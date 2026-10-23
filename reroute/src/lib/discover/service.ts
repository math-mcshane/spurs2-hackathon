import type {
  Asset,
  ClubCode,
  DiscoverHit,
  DiscoverResponse,
  DiscoveryIntent,
  PartnerFit,
} from "@/lib/contracts";
import { getScorePlayClient } from "@/lib/scoreplay";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";
import { parseDiscoveryQuery } from "./parse";

const DEMO_DISCLAIMER =
  "FICTIONAL DEMO POLICY — partner agreements and fit badges are not real Spurs/Tottenham/Nike contracts.";

type EligibleRow = {
  media_id: string;
  club_code: string | null;
  title: string | null;
  media_type: string | null;
  cdn_url: string | null;
  thumbnail_url: string | null;
  event_label: string | null;
  game_date: string | null;
  sponsors: string[] | null;
  brands_seen: string[] | null;
  tl_status: string | null;
};

type AgreementRow = {
  id: string;
  partner_id: string;
  club_code: string;
  usage_allowed: string[];
  territories: string[];
  platforms: string[];
  window_start: string;
  window_end: string;
};

type PartnerRow = { id: string; brand_slug: string };

function syntheticAsset(row: EligibleRow): Asset {
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
    metadata: { source: "eligible_media", club_code: row.club_code, demo: row.media_id.startsWith("demo-") },
    origin: "CACHED",
  };
}

async function hydrateAsset(row: EligibleRow): Promise<Asset> {
  if (row.media_id.startsWith("demo-")) return syntheticAsset(row);
  try {
    return await getScorePlayClient().getAsset(row.media_id);
  } catch {
    return syntheticAsset(row);
  }
}

function scoreFit(
  row: EligibleRow,
  intent: DiscoveryIntent,
  agreement: AgreementRow | null,
  partnerSlug: string | undefined,
): { fit: PartnerFit; reasons: string[]; agreementId?: string } {
  const brands = (row.brands_seen ?? []).map((b) => b.toLowerCase());
  const reasons: string[] = [];

  if (partnerSlug && brands.includes(partnerSlug)) {
    reasons.push(`Evidence includes brand:${partnerSlug}`);
  } else if (partnerSlug) {
    reasons.push(`No brand:${partnerSlug} on eligible facets — review required`);
  }

  if (intent.lastNight && row.event_label === "last_night_game") {
    reasons.push("Matched last-night / recent game facet");
  }

  if (!agreement) {
    reasons.push("No DEMO partnership agreement for club/partner");
    return { fit: "needs_review", reasons };
  }

  const now = Date.now();
  const start = Date.parse(agreement.window_start);
  const end = Date.parse(agreement.window_end);
  if (Number.isFinite(start) && Number.isFinite(end) && (now < start || now > end)) {
    reasons.push("Outside DEMO partnership window");
    return { fit: "conflict", reasons, agreementId: agreement.id };
  }

  if (brands.includes("rival-sponsor")) {
    reasons.push("Rival sponsor brand detected");
    return { fit: "conflict", reasons, agreementId: agreement.id };
  }

  if (partnerSlug && brands.includes(partnerSlug)) {
    reasons.push(`DEMO agreement ${agreement.id} covers ${partnerSlug}`);
    return { fit: "partner_safe", reasons, agreementId: agreement.id };
  }

  reasons.push("Partner agreement exists but brand evidence incomplete");
  return { fit: "needs_review", reasons, agreementId: agreement.id };
}

export async function discoverPartners(opts: {
  q: string;
  clubCode?: ClubCode;
  limit?: number;
}): Promise<DiscoverResponse> {
  const intent = parseDiscoveryQuery(opts.q, opts.clubCode);
  const limit = Math.min(Math.max(opts.limit ?? 12, 1), 24);

  if (!supabaseConfigured()) {
    return fallbackScorePlay(intent, limit);
  }

  const sb = getSupabaseAdmin();

  let partner: PartnerRow | null = null;
  if (intent.partnerSlug) {
    const { data } = await sb
      .from("partners")
      .select("id,brand_slug")
      .eq("brand_slug", intent.partnerSlug)
      .maybeSingle();
    partner = data as PartnerRow | null;
  }

  let agreement: AgreementRow | null = null;
  if (partner && intent.clubCode) {
    const { data } = await sb
      .from("partnership_agreements")
      .select("id,partner_id,club_code,usage_allowed,territories,platforms,window_start,window_end")
      .eq("partner_id", partner.id)
      .eq("club_code", intent.clubCode)
      .limit(1)
      .maybeSingle();
    agreement = data as AgreementRow | null;
  }

  let query = sb.from("eligible_media").select("*");
  if (intent.clubCode) query = query.eq("club_code", intent.clubCode);
  if (intent.eventLabel) query = query.eq("event_label", intent.eventLabel);
  if (intent.mediaKind === "photo") query = query.in("media_type", ["image", "photo", "Image"]);
  if (intent.mediaKind === "video") query = query.in("media_type", ["video", "Video"]);
  if (intent.partnerSlug) query = query.contains("brands_seen", [intent.partnerSlug]);

  const { data: rows, error } = await query.order("game_date", { ascending: false }).limit(limit * 2);
  if (error) {
    console.error("[discover]", error.message);
    return fallbackScorePlay(intent, limit);
  }

  let list = (rows ?? []) as EligibleRow[];
  if (!list.length) {
    // Relax brand filter — still show club eligible pool
    let q2 = sb.from("eligible_media").select("*");
    if (intent.clubCode) q2 = q2.eq("club_code", intent.clubCode);
    const { data: loose } = await q2.order("game_date", { ascending: false }).limit(limit);
    if (!loose?.length) return fallbackScorePlay(intent, limit);
    list = loose as EligibleRow[];
  }

  if (intent.passportUse && intent.passportRegion) {
    list = await filterByPassportCell(sb, list, intent.passportUse, intent.passportRegion);
  }

  if (!list.length) return fallbackScorePlay(intent, limit);
  return rankAndHydrate(list, intent, agreement, intent.partnerSlug, limit, "supabase");
}

/** Keep media whose passport cell is allow / allow_limited and not expired. */
async function filterByPassportCell(
  sb: ReturnType<typeof getSupabaseAdmin>,
  list: EligibleRow[],
  use: string,
  region: string,
): Promise<EligibleRow[]> {
  const ids = list.map((r) => r.media_id);
  if (!ids.length) return list;
  const { data } = await sb
    .from("media_passports")
    .select("media_id,passport_json,usable_until")
    .in("media_id", ids);
  if (!data?.length) return list;
  const today = new Date().toISOString().slice(0, 10);
  const ok = new Set<string>();
  for (const row of data) {
    const cells = (row.passport_json as { cells?: Record<string, Record<string, { verdict?: string }>> })?.cells;
    const verdict = cells?.[use]?.[region]?.verdict;
    if (verdict !== "allow" && verdict !== "allow_limited") continue;
    if (row.usable_until && String(row.usable_until).slice(0, 10) < today) continue;
    ok.add(row.media_id);
  }
  if (!ok.size) return list; // soft: if no passports synced, don't empty discover
  return list.filter((r) => ok.has(r.media_id));
}

async function rankAndHydrate(
  rows: EligibleRow[],
  intent: DiscoveryIntent,
  agreement: AgreementRow | null,
  partnerSlug: string | undefined,
  limit: number,
  source: DiscoverResponse["source"],
): Promise<DiscoverResponse> {
  const scored = rows.map((row) => {
    const { fit, reasons, agreementId } = scoreFit(row, intent, agreement, partnerSlug);
    return { row, fit, reasons, agreementId };
  });
  const order: Record<PartnerFit, number> = { partner_safe: 0, needs_review: 1, conflict: 2 };
  scored.sort((a, b) => order[a.fit] - order[b.fit]);

  const hits: DiscoverHit[] = [];
  for (const s of scored.slice(0, limit)) {
    const asset = await hydrateAsset(s.row);
    hits.push({
      asset,
      fit: s.fit,
      reasons: s.reasons,
      brandsSeen: s.row.brands_seen ?? [],
      eventLabel: s.row.event_label ?? undefined,
      gameDate: s.row.game_date ?? undefined,
      agreementId: s.agreementId,
    });
  }

  return { intent, hits, source, demoDisclaimer: DEMO_DISCLAIMER };
}

async function fallbackScorePlay(intent: DiscoveryIntent, limit: number): Promise<DiscoverResponse> {
  const q = [intent.partnerSlug, intent.clubCode === "TOT" ? "Tottenham" : "Spurs", intent.raw]
    .filter(Boolean)
    .join(" ");
  try {
    const assets = await getScorePlayClient().searchAssets(q, limit);
    const hits: DiscoverHit[] = assets.map((asset) => ({
      asset,
      fit: "needs_review" as const,
      reasons: ["Supabase eligible pool empty — ScorePlay fallback; partner fit not evaluated"],
      brandsSeen: [],
    }));
    return { intent, hits, source: "scoreplay_fallback", demoDisclaimer: DEMO_DISCLAIMER };
  } catch {
    return { intent, hits: [], source: "scoreplay_fallback", demoDisclaimer: DEMO_DISCLAIMER };
  }
}
