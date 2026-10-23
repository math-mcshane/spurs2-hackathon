import { KNOWN_PARTNER_BRANDS } from "@/lib/rights/sponsors";
import type { Club, MarketCode, Measurement, ParsedObjective, Product } from "./types";

/**
 * Deterministic objective parser: "I want to increase jersey sales in Mexico" → market, product,
 * KPI, deadline. Rules only (EN/FR/ES keywords), so every field it shows can be traced to the words
 * that produced it; anything not found is listed in `missing` instead of being guessed.
 */

export const MARKETS: Record<MarketCode, { label: string; words: string[] }> = {
  MX: { label: "Mexico", words: ["mexico", "mexique", "mexican", "mexicans", "mexicain", "mexicaine", "mexicains", "mexicano", "mexicanos"] },
  FR: { label: "France", words: ["france", "french", "francais", "francaise", "francia"] },
  US: { label: "United States", words: ["usa", "united states", "the us", "u.s.", "etats-unis", "estados unidos"] },
  GB: { label: "United Kingdom", words: ["uk", "united kingdom", "britain", "great britain", "england", "royaume-uni", "angleterre", "reino unido"] },
  DE: { label: "Germany", words: ["germany", "german", "allemagne", "alemania", "deutschland"] },
  ES: { label: "Spain", words: ["spain", "espagne", "espana"] },
  IT: { label: "Italy", words: ["italy", "italian", "italie", "italia"] },
  CA: { label: "Canada", words: ["canada", "canadian", "canadien", "canadienne"] },
};

const SALES_NOT_CONNECTED = (what: string): Measurement => ({
  status: "NOT_CONNECTED",
  note: `${what} by country are not connected to PULSE — no sales or conversions are claimed or predicted.`,
});
const PLATFORM_NATIVE: Measurement = {
  status: "PLATFORM_NATIVE",
  note: "Measured natively by each platform after posting; not connected to PULSE — nothing is predicted, and engagement is not evidence of purchase intent.",
};

export const PRODUCTS: Record<
  Product,
  { label: string; verb: string; kpi: string; words: string[]; measurement: Measurement; commerce?: "store" | "ticketing" }
> = {
  jersey: {
    label: "Jerseys",
    verb: "Sell jerseys",
    kpi: "Jersey sales",
    words: ["jersey", "jerseys", "maillot", "maillots", "camiseta", "camisetas", "shirt", "shirts", "kit", "kits"],
    measurement: SALES_NOT_CONNECTED("Club e-commerce orders"),
    commerce: "store",
  },
  tickets: {
    label: "Tickets",
    verb: "Sell tickets",
    kpi: "Ticket sales",
    words: ["ticket", "tickets", "billet", "billets", "billetterie", "boleto", "boletos", "entradas", "seats"],
    measurement: SALES_NOT_CONNECTED("Ticketing sales"),
    commerce: "ticketing",
  },
  merch: {
    label: "Merchandise",
    verb: "Sell merchandise",
    kpi: "Merchandise sales",
    words: ["merch", "merchandise", "store", "shop", "boutique", "tienda"],
    measurement: SALES_NOT_CONNECTED("Club e-commerce orders"),
    commerce: "store",
  },
  engagement: {
    label: "Engagement",
    verb: "Maximize engagement",
    kpi: "Engagement (likes, comments, shares, saves)",
    words: ["engagement", "engage", "interactions", "likes", "shares", "views", "vues", "reach", "portee", "alcance"],
    measurement: PLATFORM_NATIVE,
  },
  followers: {
    label: "Followers",
    verb: "Grow followers",
    kpi: "Follower growth",
    words: ["follower", "followers", "abonnes", "seguidores", "audience"],
    measurement: PLATFORM_NATIVE,
  },
  subscriptions: {
    label: "Subscriptions",
    verb: "Grow subscriptions",
    kpi: "Subscriptions",
    words: ["subscription", "subscriptions", "league pass", "abonnement", "abonnements", "suscripcion", "suscripciones"],
    measurement: SALES_NOT_CONNECTED("Subscription sales"),
    commerce: "store",
  },
  sponsor: {
    label: "Sponsor activation",
    verb: "Run a sponsor activation",
    kpi: "Sponsor deliverables",
    words: ["sponsor", "sponsors", "partner", "partners", "partenaire", "partenaires", "patrocinador", "patrocinadores"],
    measurement: {
      status: "TRACKED_IN_PULSE",
      note: "Published deliverables are counted in the PULSE ledger only when recorded with a post URL.",
    },
  },
};

const GLOBAL_WORDS = /\b(global|globally|worldwide|international|internationally|mondial|mondiale|monde|mundial|mundo)\b/;

const MONTHS: [number, string[]][] = [
  [0, ["january", "janvier", "enero"]],
  [1, ["february", "fevrier", "febrero"]],
  [2, ["march", "mars", "marzo"]],
  [3, ["april", "avril", "abril"]],
  [4, ["may", "mai", "mayo"]],
  [5, ["june", "juin", "junio"]],
  [6, ["july", "juillet", "julio"]],
  [7, ["august", "aout", "agosto"]],
  [8, ["september", "septembre", "septiembre"]],
  [9, ["october", "octobre", "octubre"]],
  [10, ["november", "novembre", "noviembre"]],
  [11, ["december", "decembre", "diciembre"]],
];

const UNIT_DAYS: [RegExp, number][] = [
  [/^(day|days|jour|jours|dia|dias)$/, 1],
  [/^(week|weeks|semaine|semaines|semana|semanas)$/, 7],
  [/^(month|months|mois|mes|meses)$/, 30],
];

/** Lowercase, strip accents, collapse whitespace — so "México" and "mexico" match the same word. */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/\s+/g, " ");
}

/** Earliest whole-word match of any word in `table`, so "Mexico" in a sentence wins over later words. */
function firstMatch<K extends string>(text: string, table: Record<K, { words: string[] }>): { key: K; matched: string } | undefined {
  let best: { key: K; matched: string; at: number } | undefined;
  for (const [key, { words }] of Object.entries(table) as [K, { words: string[] }][]) {
    for (const word of words) {
      const m = new RegExp(`(?<![\\w-])${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`).exec(text);
      if (m && (!best || m.index < best.at)) best = { key, matched: m[0], at: m.index };
    }
  }
  return best && { key: best.key, matched: best.matched };
}

/** Partners the bundled rule packages name (AIA, Nike, Kraken…), matched whole-word like any other keyword. */
const KNOWN_PARTNERS: Record<string, { words: string[] }> = Object.fromEntries(KNOWN_PARTNER_BRANDS.map((b) => [b, { words: [normalize(b)] }]));

/** One to three capitalised words: how a goal writes a brand ("AIA", "Red Bull"). */
const NAME = String.raw`([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,2})`;
const AFTER_PARTNER_WORD = new RegExp(String.raw`\b(?:[Oo]ur\s+)?(?:[Pp]artner|[Ss]ponsor)\s+${NAME}`);
const AFTER_VERB = new RegExp(String.raw`\b(?:[Pp]romote|[Aa]ctivate|[Ff]eature|[Ss]howcase)\s+${NAME}(?=\s+(?:with|to|for|in|on|across|among|using)\b|\s*[,.!?]|\s*$)`);
/** Words that can follow "promote" capitalised but are the club, a market or a product — never a partner. */
const NOT_A_PARTNER = /\b(tottenham|hotspur|spurs|thfc|san antonio|club|team|fans?|supporters?)\b/;

/**
 * The partner the goal promotes, as written: a partner a bundled rule package names ("our partner AIA"), else a
 * capitalised name right after "our partner"/"sponsor" or a promote-verb ("Promote Heineken with UK fans"). Null
 * when the goal names none ("Activate our sponsor …"). Naming a brand grants nothing: the rules decide.
 */
function parseTargetSponsor(raw: string): string | null {
  const known = firstMatch(normalize(raw), KNOWN_PARTNERS);
  if (known) return known.key;
  const name = (AFTER_PARTNER_WORD.exec(raw) ?? AFTER_VERB.exec(raw))?.[1].replace(/[.,!?]+$/, "").trim();
  if (!name || /['’]s$/.test(name)) return null;
  const n = normalize(name);
  const elsewhere = firstMatch(n, MARKETS) ?? firstMatch(n, PRODUCTS);
  return NOT_A_PARTNER.test(n) || elsewhere ? null : name;
}

/** `d = 0` is the last day of month `m - 1` (Date.UTC rolls over), used for "by <month>". */
const endOfDayUtc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d, 23, 59, 59)).toISOString();

function parseDeadline(text: string, now: Date): ParsedObjective["deadline"] {
  const iso = /\b(20\d{2})-(\d{2})-(\d{2})\b/.exec(text);
  if (iso) return { text: iso[0], iso: endOfDayUtc(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])) };

  const rel = /\b(?:in|within|dans|en|d'ici)\s+(\d{1,3})\s+([a-z]+)/.exec(text);
  if (rel) {
    const unit = UNIT_DAYS.find(([re]) => re.test(rel[2]));
    if (unit) return { text: rel[0], iso: new Date(now.getTime() + Number(rel[1]) * unit[1] * 86_400_000).toISOString() };
  }

  const monthWords = MONTHS.flatMap(([, words]) => words).join("|");
  const byMonth = new RegExp(`\\b(?:by|before|until|avant|d'ici|antes de|para|by the end of|end of|fin)\\s+(?:(?:the\\s+)?end\\s+of\\s+)?(${monthWords})(?:\\s+(20\\d{2}))?\\b`).exec(text);
  if (byMonth) {
    const month = MONTHS.find(([, words]) => words.includes(byMonth[1]))![0];
    const year = byMonth[2] ? Number(byMonth[2]) : month < now.getUTCMonth() ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    return { text: byMonth[0], iso: endOfDayUtc(year, month + 1, 0) };
  }

  const season = /\b(end of (?:the )?season|fin de (?:la )?saison|fin de temporada|this season|cette saison)\b/.exec(text);
  if (season) return { text: season[0] };
  return undefined;
}

export function parseObjective(raw: string, now: Date = new Date()): ParsedObjective {
  const text = normalize(raw);
  const market = firstMatch(text, MARKETS);
  const targetSponsor = parseTargetSponsor(raw);
  // A goal that names a partner to promote is a sponsor activation even without the word "sponsor".
  const product = firstMatch(text, PRODUCTS) ?? (targetSponsor ? { key: "sponsor" as const, matched: targetSponsor } : undefined);
  const deadline = parseDeadline(text, now);
  // Bare "Spurs" is ambiguous (Tottenham's nickname and San Antonio's name): only explicit names count.
  const club: Club | undefined = /\b(tottenham|thfc|hotspur)\b/.test(text)
    ? "tottenham"
    : /\bsan antonio\b/.test(text)
      ? "spurs"
      : undefined;

  const global = !market && GLOBAL_WORDS.test(text);
  const marketLabel = market && MARKETS[market.key].label;
  const p = product && PRODUCTS[product.key];
  const where = marketLabel ? ` in ${marketLabel}` : global ? " globally" : "";
  const sponsored = product?.key === "sponsor";
  const verb = sponsored && targetSponsor ? `Promote ${targetSponsor}` : p?.verb;
  return {
    raw,
    summary: verb ? `${verb}${where}` : marketLabel ? `Grow the ${marketLabel} market` : "Objective not understood",
    club,
    scope: market ? "MARKET" : global ? "GLOBAL" : "UNSPECIFIED",
    market: market && { code: market.key, label: MARKETS[market.key].label, matched: market.matched },
    product: product && { key: product.key, label: PRODUCTS[product.key].label, matched: product.matched },
    targetSponsor,
    kpi: `${p ? (sponsored && targetSponsor ? `${targetSponsor} partner deliverables` : p.kpi) : "Market growth"}${where}${deadline ? ` · ${deadline.text}` : ""}`,
    deadline,
    missing: [!market && !global && "market", !product && "product", !deadline && "deadline"].filter(
      (m): m is "market" | "product" | "deadline" => typeof m === "string",
    ),
    measurement: p?.measurement ?? SALES_NOT_CONNECTED("Business results"),
    parsedAt: now.toISOString(),
  };
}
