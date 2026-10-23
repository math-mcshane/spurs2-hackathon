/**
 * Who the club's commercial partners are: facts about the CLUB, separate from any rule package. A rule package decides
 * what a post may show; this list only says a brand on screen is the club's own partner, not a third-party brand.
 * It never permits anything: a partner the selected rules don't name is a contract question for a reviewer.
 * Pure (no imports) so the engine and the Studio read the same list.
 */

export interface ClubPartner {
  name: string;
  /** The relationship as the club lists it ("Official Sleeve Partner"). */
  relationship: string;
  /** CLUB_BRAND = the club's own label (merchandise), not a sponsor. */
  kind: "PARTNER" | "CLUB_BRAND";
  /** UNVERIFIED = from older listings; whether it is still active was not confirmed. */
  status: "CURRENT" | "UNVERIFIED";
  /** Brand-label slugs ("brand:<slug>", "brand:<slug>-…") that name it. */
  labels: string[];
  source?: string;
}

export interface ClubPartnerList {
  clubName: string;
  source: string;
  partners: ClubPartner[];
}

type Entry = [name: string, relationship: string, labels: string[], extra?: Partial<Pick<ClubPartner, "kind" | "status" | "source">>];

const list = (entries: Entry[]): ClubPartner[] =>
  entries.map(([name, relationship, labels, extra]) => ({ name, relationship, labels, kind: "PARTNER", status: "CURRENT", ...extra }));

const UNVERIFIED = { status: "UNVERIFIED" } as const;

/** Keyed by the rule packages' `applicability.club`. */
export const CLUB_PARTNERS: Readonly<Record<string, ClubPartnerList>> = {
  tottenham: {
    clubName: "Tottenham Hotspur",
    source: "Club partner list supplied by the PULSE team, 23 Oct 2026",
    partners: list([
      ["AIA", "Global Principal Partner", ["aia"]],
      ["Nike", "Official Kit Provider", ["nike"]],
      [
        "Kraken",
        "Official Crypto & Web3 Partner and Sleeve Partner",
        ["kraken"],
        { source: "https://www.tottenhamhotspur.com/news/986615/tottenham-hotspur-partners-with-crypto-platform-kraken" },
      ],
      ["Betano", "Official Training Wear Partner", ["betano"]],
      ["Alipay", "Official Payment Partner", ["alipay"]],
      ["Sports Illustrated", "Official Partner", ["sports-illustrated"]],
      ["Sports Illustrated Tickets", "Official Fan Experience Partner", ["sports-illustrated-tickets"]],
      ["HPE", "Official IT Enterprise Networking Partner", ["hpe", "hewlett-packard-enterprise"]],
      ["Salesforce", "Official CRM Partner", ["salesforce"]],
      ["Tata Consultancy Services", "Official Digital Transformation Partner", ["tata-consultancy-services", "tcs"]],
      ["Pravha", "Official Beer Partner", ["pravha"]],
      ["Sidiz", "Official Furniture Manufacturing Partner", ["sidiz"]],
      ["Tiger", "Official International Beer Partner", ["tiger"]],
      ["BP", "Official Motor Oil, Lubricants, and EV Fluids Partner", ["bp"]],
      ["Coca-Cola", "Official Soft Drinks Partner in Europe", ["coca-cola"]],
      ["Infinox", "Official Online Trading Partner", ["infinox"]],
      ["Monster Energy", "Official Energy Drink Partner", ["monster-energy", "monster"]],
      ["$SPURS", "Official Fan Token Partner", ["spurs-fan-token"]],
      ["STANLEY", "Official Tools Partner", ["stanley"]],
      ["Cadbury", "Official Snack Partner", ["cadbury"]],
      ["YETI", "Official Insulated Drinkware and Luggage Partner", ["yeti"]],
      ["Soccer Supplement", "Official Performance Nutrition Partner", ["soccer-supplement"]],
      ["Dashing", "Official Malaysian Fragrance Partner", ["dashing"]],
      ["VSbet", "Official Regional Betting Partner for Asia", ["vsbet"]],
      ["HP", "Official Workplace Solutions Partner", ["hp"]],
      ["Sportsbet.io", "Official NA & Africa Betting Partner", ["sportsbet-io", "sportsbet"]],
    ]),
  },
  spurs: {
    clubName: "San Antonio Spurs",
    source: "Club partner list supplied by the PULSE team, 23 Oct 2026 (the last eight from older listings, not confirmed current)",
    partners: list([
      ["Frost Bank", "arena naming rights (Frost Bank Center); presents the Official Spurs Mobile App", ["frost-bank", "frost"]],
      ["Ledger", "jersey patch partner (multi-year global deal); presents the City Edition uniforms", ["ledger"]],
      ["DAZN", "exclusive local streaming partner for 2026-27", ["dazn"]],
      ["H-E-B", "presenting partner of the regular-season schedule", ["h-e-b", "heb"]],
      ["Victory Capital", "naming rights partner of the Victory Capital Performance Center; Official Investment Partner", ["victory-capital"]],
      ["RBFCU", "official credit union; presenting partner of the Season Ticket Membership Program", ["rbfcu"]],
      ["Methodist Healthcare", "Official Healthcare System; Official Partner of the Spurs and San Antonio FC", ["methodist-healthcare", "methodist"]],
      ["Ticketmaster", "presenting partner of home games at Frost Bank Center", ["ticketmaster"]],
      ["Meter", "official network infrastructure provider (announced March 2026)", ["meter"]],
      ["Arena Club", "official partner (announced January 2026)", ["arena-club"]],
      ["Engine", "official travel management platform partner (announced November 2025)", ["engine"]],
      ["Nike", "designs the team's uniforms", ["nike"]],
      ["Self", "longtime partner on the City Edition court; jersey patch sponsor before Ledger", ["self"]],
      ["Bexar Goods", "the Spurs' own private-label merchandise brand", ["bexar-goods"], { kind: "CLUB_BRAND" }],
      ["Valero", "official partner since 2014", ["valero"], UNVERIFIED],
      ["SWBC", "presenting partner since 2014", ["swbc"], UNVERIFIED],
      ["UT Health San Antonio", "official sports medicine partner (announced September 2023)", ["ut-health-san-antonio", "ut-health"], UNVERIFIED],
      ["Michelob Ultra", "beer partner since December 2021", ["michelob-ultra", "michelob"], UNVERIFIED],
      ["Sprite", "official partner since 1992", ["sprite"], UNVERIFIED],
      ["Whataburger", "multi-year partnership announced June 2020", ["whataburger"], UNVERIFIED],
      ["Humble House", "official partner since December 2023", ["humble-house"], UNVERIFIED],
      ["USAA", "official military appreciation partner (2020 listing)", ["usaa"], UNVERIFIED],
    ]),
  },
};

/** The club partner a normalized brand label ("brand:kraken", "brand:kraken-logo") names, longest match first. */
export function clubPartnerOf(club: string, label: string): (ClubPartner & { clubName: string }) | undefined {
  const entry = CLUB_PARTNERS[club.trim().toLowerCase()];
  if (!entry || !label.startsWith("brand:")) return undefined;
  const brand = label.slice("brand:".length);
  let best: { partner: ClubPartner; len: number } | undefined;
  for (const partner of entry.partners) {
    for (const l of partner.labels) {
      if ((brand === l || brand.startsWith(`${l}-`)) && l.length > (best?.len ?? 0)) best = { partner, len: l.length };
    }
  }
  return best ? { ...best.partner, clubName: entry.clubName } : undefined;
}

/** "a Tottenham Hotspur partner (Official Sleeve Partner)": what the list says, only as strongly as it supports. */
export function clubPartnerRole(p: ClubPartner & { clubName: string }): string {
  if (p.kind === "CLUB_BRAND") return `${p.clubName}${p.clubName.endsWith("s") ? "'" : "'s"} own brand (${p.relationship}), not a sponsor`;
  if (p.status === "UNVERIFIED") return `listed as a ${p.clubName} partner in older listings (${p.relationship}; not confirmed current)`;
  return `a ${p.clubName} partner (${p.relationship})`;
}
