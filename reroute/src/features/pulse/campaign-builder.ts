import type { EditPlan, PublishIntent } from "@/lib/contracts";
import { CLUBS } from "./clubs";
import { buildHandoff, handoffToReroute } from "./handoff-to-reroute";
import { PRODUCTS, marketsLabel, objectiveMarkets } from "./objective-parser";
import type {
  CampaignDraft,
  CampaignRights,
  CampaignView,
  Club,
  CommerceDestination,
  Language,
  LedgerEntry,
  MarketCode,
  MediaCandidate,
  OpportunityView,
  ParsedObjective,
  Product,
  SponsorBrief,
} from "./types";

/**
 * Campaign proposal drafts: deterministic templates over facts PULSE already holds (objective,
 * market analysis, ScorePlay asset, REROUTE intent). No stock, availability, sales or engagement
 * claims; no biography; nothing is posted and no ads are bought.
 */

const LANGUAGE_BY_MARKET: Record<MarketCode, Language> = { MX: "es", ES: "es", FR: "fr", DE: "de", IT: "it", US: "en", GB: "en", CA: "en" };
const LANGUAGE_LABEL: Record<Language, string> = { en: "English", es: "Spanish", fr: "French", de: "German", it: "Italian" };
const CLUB_HASHTAG: Record<Club, string> = { spurs: "#GoSpursGo", tottenham: "#COYS" };
const DISCOVERED_LABEL: Record<MediaCandidate["discoveredBy"], string> = { FILENAME: "filename", PLAYER_TAG: "player-tag", TEAM_TAG: "team-tag", INDEX_SEARCH: "index-search" };

type Templated = "default" | Product;
type Copy = (hook: string, club: string) => string;

/** Body copy per objective product. Languages without a template fall back to English (flagged). */
const BODY: Record<Templated, Partial<Record<Language, Copy>>> = {
  jersey: {
    en: (h, c) => `${h} Wear the ${c} colors.`,
    es: (h, c) => `${h} Lleva los colores de ${c}.`,
    fr: (h, c) => `${h} Portez les couleurs de ${c}.`,
  },
  merch: {
    en: (h, c) => `${h} Gear up with ${c}.`,
    es: (h, c) => `${h} Equípate con ${c}.`,
    fr: (h, c) => `${h} Équipez-vous aux couleurs de ${c}.`,
  },
  tickets: {
    en: (h) => `${h} Be there next time.`,
    es: (h) => `${h} Vive el próximo partido en el estadio.`,
    fr: (h) => `${h} Vivez le prochain match au stade.`,
  },
  subscriptions: {
    en: (h) => `${h} See how to watch the next game.`,
    es: (h) => `${h} Descubre cómo ver el próximo partido.`,
    fr: (h) => `${h} Découvrez comment regarder le prochain match.`,
  },
  engagement: {
    en: (h) => `${h} What was your favorite moment? 👇`,
    es: (h) => `${h} ¿Cuál fue tu momento favorito? 👇`,
    fr: (h) => `${h} Votre moment préféré ? 👇`,
  },
  followers: {
    en: (h, c) => `${h} Follow ${c} for more.`,
    es: (h, c) => `${h} Sigue a ${c} para no perderte nada.`,
    fr: (h, c) => `${h} Suivez ${c} pour ne rien manquer.`,
  },
  sponsor: {
    en: (h) => `${h} [Partner credit exactly as specified in the brief]`,
    es: (h) => `${h} [Mención del patrocinador según el brief]`,
    fr: (h) => `${h} [Mention du partenaire selon le brief]`,
  },
  default: {
    en: (h) => h,
    es: (h) => h,
    fr: (h) => h,
  },
};

/** CTAs describe an action, never availability ("browse", not "in stock" / "get yours now"). */
const CTA: Record<Templated, Partial<Record<Language, string>>> = {
  jersey: { en: "Browse jerseys", es: "Ver camisetas", fr: "Voir les maillots" },
  merch: { en: "Browse the store", es: "Ver la tienda", fr: "Voir la boutique" },
  tickets: { en: "View ticket options", es: "Ver opciones de boletos", fr: "Voir la billetterie" },
  subscriptions: { en: "See viewing options", es: "Ver opciones para ver", fr: "Voir les offres" },
  engagement: { en: "Comment and share", es: "Comenta y comparte", fr: "Commentez et partagez" },
  followers: { en: "Follow us", es: "Síguenos", fr: "Suivez-nous" },
  sponsor: { en: "Per partner brief", es: "Según el brief del patrocinador", fr: "Selon le brief partenaire" },
  default: { en: "Comment and share", es: "Comenta y comparte", fr: "Commentez et partagez" },
};

export const X_CHAR_LIMIT = 280;
/** X counts every link as 23 characters (t.co). */
const X_URL_LENGTH = 23;
const INSTAGRAM_CAPTION_LIMIT = 2200;
/** Facebook post text limit. */
const FACEBOOK_POST_LIMIT = 63_206;

export const SAFEGUARDS = [
  "No stock or availability claim: PULSE has no inventory data.",
  "No sales, conversions or engagement are predicted; engagement is not evidence of purchase intent.",
  "Audience market comes from the objective and source-reported regions — never from the language of posts.",
  "No player biography, nationality or club is stated or implied unless ScorePlay identity data says so.",
  "PULSE never publishes posts or buys ads.",
  "Publication requires a verified REROUTE clearance and human approval; a demo policy never authorizes publication.",
];

/** What a proposal is composed from; the opportunity board and the goal flow each supply it. */
export type ComposeInput = {
  id: string;
  ownerId: string;
  club: Club;
  objective: ParsedObjective;
  candidate: MediaCandidate;
  /** The exact edit and publish intent REROUTE is asked about. */
  reroute: { edit: EditPlan; intent: PublishIntent };
  /** Hooks written per language; languages without one fall back to English (and are flagged). */
  hooks: Partial<Record<Language, string>>;
  fallbackHook: string;
  angle: string;
  cohort: string;
  /** Where demand evidence for the market comes from, if any. */
  marketBasis?: string;
  rationale: string[];
  evidenceLabels: string[];
  destination?: CommerceDestination;
  /** Set when the post runs as organic content (a recovery changed the use): no store/ticketing call to action. */
  organicNote?: string;
  now: Date;
  previous?: CampaignDraft;
};

export function composeCampaign(input: ComposeInput): CampaignDraft {
  const { objective, candidate, hooks, destination, now, previous } = input;
  const product = objective.product?.key;
  const templated: Templated = input.organicNote ? "default" : (product ?? "default");
  const club = CLUBS[input.club].label;
  const markets = objectiveMarkets(objective);
  // One post per channel serves every named market: one copy line per market language ("France and the US" → fr, en).
  const languages: Language[] = markets.length ? [...new Set(markets.map((m) => LANGUAGE_BY_MARKET[m.code]))] : ["en"];
  const language = languages[0];
  const copyLanguages = [...new Set(languages.map((l): Language => (BODY[templated][l] && hooks[l] ? l : "en")))];
  const copyLanguage = copyLanguages[0];
  const hookIn = (l: Language) => hooks[l] ?? hooks.en ?? input.fallbackHook;
  const hook = hookIn(copyLanguage);
  // A hook that reads the same in every language (a player's name) opens the post once.
  const body = copyLanguages.map((l, i) => BODY[templated][l]!(i > 0 && hookIn(l) === hook ? "" : hookIn(l), club).trim()).filter(Boolean).join("\n");
  const ctaText = copyLanguages.map((l) => CTA[templated][l]!).join(" / ");
  const segment = input.reroute.edit.segments[0];

  const commerceKind = product && !input.organicNote ? PRODUCTS[product].commerce : undefined;
  const cta: CampaignDraft["cta"] = !commerceKind
    ? { text: ctaText, status: "NOT_APPLICABLE", note: input.organicNote ?? "This objective has no store or ticketing link." }
    : destination
      ? {
          text: ctaText,
          status: "READY",
          destination,
          note:
            destination.source === "CONFIGURED"
              ? "Destination configured by the club (PULSE_COMMERCE_DESTINATIONS). PULSE does not know stock or availability."
              : "Destination entered by the producer — confirm it is an authorized store. PULSE does not know stock or availability.",
        }
      : {
          text: ctaText,
          status: "NOT_CONFIGURED",
          note: "No club-configured store link (PULSE_COMMERCE_DESTINATIONS). Add an https link on the club's own domain to enable the call to action; until then the copy carries no buy prompt.",
        };

  const hashtag = CLUB_HASHTAG[input.club];
  // Without a destination a commerce objective gets no CTA line at all: no buy prompt without an authorized link.
  const ctaLine = (withUrl: boolean) =>
    cta.status === "READY" ? (withUrl ? `\n${cta.text}: ${cta.destination!.url}` : `\n${cta.text} — link in bio`) : cta.status === "NOT_APPLICABLE" ? `\n${cta.text}` : "";
  const instagram = `${body}${ctaLine(false)}\n\n${hashtag}`;
  const linked = `${body}${ctaLine(true)}\n\n${hashtag}`;
  const xCount = cta.status === "READY" ? linked.length - cta.destination!.url.length + X_URL_LENGTH : linked.length;

  const market = objective.market;
  // The copy's locale: the market's language there (es-MX for Mexico) — only for one market, when the copy is in it.
  const locale = market && markets.length === 1 && copyLanguage === language ? `${language}-${market.code}` : undefined;
  const unlocalized = languages.filter((l) => !copyLanguages.includes(l));
  return {
    id: previous?.id ?? input.id,
    schemaVersion: 1,
    opportunityId: input.ownerId,
    club: input.club,
    createdAt: previous?.createdAt ?? now.toISOString(),
    updatedAt: now.toISOString(),
    objective: { summary: objective.summary, raw: objective.raw, kpi: objective.kpi, measurement: objective.measurement },
    audience: {
      scope: objective.scope,
      market: market && { code: market.code, label: market.label },
      cohort: input.cohort,
      language,
      ...(copyLanguages.length > 1 ? { languages: copyLanguages } : {}),
      ...(locale ? { locale } : {}),
      basis:
        (market
          ? `Market${markets.length > 1 ? "s" : ""} ${marketsLabel(markets)} come${markets.length > 1 ? "" : "s"} from the objective${input.marketBasis ? `; ${input.marketBasis}` : ""}.`
          : objective.scope === "GLOBAL"
            ? "Global audience from the objective; no single territory."
            : "No market stated in the objective.") +
        ` Copy is written in ${copyLanguages.map((l) => LANGUAGE_LABEL[l]).join(" and ")}${locale ? ` (${locale})` : ""} for that audience; nobody's location is inferred from language.`,
    },
    media: {
      scoreplayAssetId: candidate.scoreplayAssetId,
      title: candidate.title,
      thumbnailUrl: candidate.thumbnailUrl,
      startSeconds: segment.start,
      endSeconds: segment.end,
      foundBy: candidate.foundBy,
      origin: candidate.origin,
      mapping: candidate.mapping,
    },
    rationale: [
      ...input.rationale,
      ...(candidate.mapping?.via === "FILENAME_DURATION"
        ? ["TwelveLabs video linked to this ScorePlay asset by exact filename and duration (unique in both directions)."]
        : []),
    ],
    creative: { angle: input.angle, hook, hookLanguage: copyLanguage },
    cta,
    channels: [
      {
        channel: "instagram",
        format: "Reel · vertical 9:16 · 12–15 s",
        copy: instagram,
        linkHandling: "Caption links are not clickable: use the link in bio or a story link sticker.",
        characterCount: instagram.length,
        limit: INSTAGRAM_CAPTION_LIMIT,
        withinLimit: instagram.length <= INSTAGRAM_CAPTION_LIMIT,
      },
      {
        channel: "facebook",
        format: "Reel or feed video · vertical 9:16",
        copy: linked,
        linkHandling: "The link can sit in the post text.",
        characterCount: linked.length,
        limit: FACEBOOK_POST_LIMIT,
        withinLimit: linked.length <= FACEBOOK_POST_LIMIT,
      },
      {
        channel: "x",
        format: "Video post",
        copy: linked,
        linkHandling: `Link in the post; counts as ${X_URL_LENGTH} characters.`,
        characterCount: xCount,
        limit: X_CHAR_LIMIT,
        withinLimit: xCount <= X_CHAR_LIMIT,
      },
    ],
    rerouteIntent: input.reroute.intent,
    evidenceLabels: [
      ...input.evidenceLabels,
      `Footage: ${candidate.origin} ScorePlay asset${candidate.foundBy === "TWELVELABS" ? `, moment from TwelveLabs (${candidate.origin})` : " (SCOREPLAY_METADATA_FALLBACK)"}`,
      ...unlocalized.map((l) => `Copy not localized for ${LANGUAGE_LABEL[l]} — translate before use`),
    ],
    safeguards: SAFEGUARDS,
  };
}

export type DraftInput = {
  view: OpportunityView;
  objective: ParsedObjective;
  candidate: MediaCandidate;
  brief?: SponsorBrief;
  destination?: CommerceDestination;
  now: Date;
  previous?: CampaignDraft;
};

/** Proposal for a fan-signal opportunity on the board. */
export function buildCampaignDraft({ view, objective, candidate, brief, destination, now, previous }: DraftInput): CampaignDraft {
  // Same derivation as the REROUTE handoff, so the draft shows exactly what REROUTE will be asked.
  const { edit, intent } = handoffToReroute(buildHandoff(view, candidate), { brief, territory: objective.market?.code, now });
  const segment = edit.segments[0];
  const signalMode = view.signal.mode === "FIXTURE" ? "SIMULATED demo replay" : view.signal.mode === "MANUAL" ? "producer-entered" : "public API";
  const marketMode = view.market?.analysis?.mode === "FIXTURE" ? "SIMULATED counts" : undefined;
  return composeCampaign({
    id: `cmp-${view.id}`,
    ownerId: view.id,
    club: view.club,
    objective,
    candidate,
    reroute: { edit, intent },
    hooks: view.hooks,
    fallbackHook: view.headline,
    angle: view.angle,
    cohort: view.targetAudienceCohort,
    marketBasis: `demand evidence is the source-reported region aggregate${marketMode ? ` (${marketMode})` : ""}`,
    rationale: [
      // The market `why` already includes the objective-fit note.
      ...(view.market ? [view.market.why] : [view.interestSummary, `Content: ${view.contentTraits.join(", ") || "untagged"}.`]),
      candidate.foundBy === "TWELVELABS"
        ? `Timecodes ${segment.start.toFixed(1)}–${segment.end.toFixed(1)} s: TwelveLabs moment #${candidate.rank ?? "?"} for “${candidate.query ?? view.semanticQuery}”.`
        : `ScorePlay ${DISCOVERED_LABEL[candidate.discoveredBy]} match (metadata fallback — no video-intelligence moment); the default first ${Math.round(segment.end - segment.start)} s are proposed — check the cut in REROUTE.`,
    ],
    evidenceLabels: [
      `Fan signals: ${signalMode}`,
      ...(marketMode ? [`Market signals: ${marketMode}`] : []),
      ...(brief?.dataStatus === "DEMO" ? [`Sponsor brief: FICTIONAL (${brief.partnerLabel})`] : []),
    ],
    destination,
    now,
    previous,
  });
}

/**
 * Attaches REROUTE's recorded verdict — only if REROUTE checked exactly this draft's asset, cut and
 * territory. Otherwise the draft is NOT_CHECKED; PULSE never derives a rights state itself.
 */
export function campaignView(draft: CampaignDraft, ledger: LedgerEntry, activeObjective: ParsedObjective | undefined): CampaignView {
  const sent = ledger.handoff;
  const verdict = ledger.rights;
  const seg = sent?.edit.segments[0];
  const matchesDraft =
    !!sent &&
    !!verdict &&
    sent.scoreplayAssetId === draft.media.scoreplayAssetId &&
    seg?.start === draft.media.startSeconds &&
    seg?.end === draft.media.endSeconds &&
    sent.intent.territory === draft.rerouteIntent.territory;
  const rights: CampaignRights =
    matchesDraft && verdict
      ? {
          state: verdict.state,
          source: "REROUTE",
          matchesDraft: true,
          checkedAt: verdict.checkedAt,
          policyId: verdict.policyId,
          policyFictional: verdict.policyFictional,
          note: "Verdict recorded from REROUTE for this asset, cut and territory.",
        }
      : {
          state: "NOT_CHECKED",
          source: "REROUTE",
          matchesDraft: false,
          note: sent
            ? "REROUTE checked a different asset, cut or territory — send this draft to REROUTE."
            : "Not sent to REROUTE yet.",
        };
  return { ...draft, rights, stale: activeObjective?.summary !== draft.objective.summary };
}
