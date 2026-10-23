import type { ClubCode, DiscoveryIntent } from "@/lib/contracts";

/** Lightweight NL → DiscoveryIntent (no LLM). */
export function parseDiscoveryQuery(q: string, clubHint?: ClubCode): DiscoveryIntent {
  const raw = q.trim();
  const lower = raw.toLowerCase();

  let clubCode = clubHint;
  if (!clubCode) {
    if (/\b(tottenham|hotspur|thfc|spurs\s*fc)\b/.test(lower)) clubCode = "TOT";
    else if (/\b(san\s*antonio|nba|wemby|wembanyama)\b/.test(lower)) clubCode = "SAS";
    else if (/\bspurs\b/.test(lower)) clubCode = "SAS";
  }

  let partnerSlug: string | undefined;
  if (/\bnike\b/.test(lower)) partnerSlug = "nike";
  else if (/\brival\b/.test(lower)) partnerSlug = "rival-sponsor";
  else if (/\bpartner\b/.test(lower)) partnerSlug = "nike"; // default DEMO partner story

  const lastNight = /\b(last\s*nights?|yesterday|last\s*game|gameday|matchday)\b/.test(lower);
  const weekendPublish = /\b(weekend|saturday|sunday|this\s*week)\b/.test(lower);

  let mediaKind: DiscoveryIntent["mediaKind"] = "any";
  if (/\b(photo|photos|image|images|still)\b/.test(lower)) mediaKind = "photo";
  else if (/\b(video|clip|footage|reel)\b/.test(lower)) mediaKind = "video";

  const eventLabel = lastNight ? "last_night_game" : undefined;

  let passportUse: DiscoveryIntent["passportUse"];
  if (/\btiktoks?\b/.test(lower)) passportUse = "tiktok";
  else if (/\binstagram\b|\big\b/.test(lower)) passportUse = "instagram";
  else if (/\byoutubes?\b/.test(lower)) passportUse = "youtube";
  else if (/\b\bx\b|\btwitter\b/.test(lower)) passportUse = "x";
  else if (/\bvenue\b|\bscreen\b/.test(lower)) passportUse = "venue_screen";
  else if (/\bsponsor\b/.test(lower)) passportUse = "sponsor_use";
  else if (/\b(club\s*app|app)\b/.test(lower)) passportUse = "club_app";

  let passportRegion: DiscoveryIntent["passportRegion"];
  if (/\b(uk|united\s*kingdom|britain|gb)\b/.test(lower)) passportRegion = "UK";
  else if (/\b(us|usa|united\s*states)\b/.test(lower)) passportRegion = "US";
  else if (/\b(row|rest\s*of\s*(the\s*)?world|international)\b/.test(lower)) passportRegion = "ROW";

  return {
    raw,
    clubCode,
    partnerSlug,
    eventLabel,
    mediaKind,
    lastNight,
    weekendPublish,
    passportUse,
    passportRegion,
  };
}

/** Next Saturday 12:00 local → ISO for intent presets. */
export function nextWeekendPublishAt(from = new Date()): string {
  const d = new Date(from);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const add = day === 6 ? 0 : (6 - day + 7) % 7 || 7;
  d.setDate(d.getDate() + (day === 6 ? 0 : add));
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}
