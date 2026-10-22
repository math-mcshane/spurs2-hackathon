/**
 * Pure TwelveLabs → REROUTE mapping. No I/O; unit-tested in parse.test.ts.
 */
import { z } from "zod";
import type { DataOrigin, Evidence, SearchHit } from "@/lib/contracts";

/**
 * user_metadata keys that may carry the ScorePlay media id. The Builder Brief calls it `custom_id`;
 * TwelveLabs v1.3 has no `custom_id` field on videos/indexed assets, so it lives in `user_metadata`.
 * First match wins. Confirm the exact key with organizers (see API_NOTES.md).
 */
export const CUSTOM_ID_KEYS = ["custom_id", "customId", "scoreplay_id", "scoreplayMediaId", "scoreplay_media_id"] as const;

export function customIdFromMetadata(meta: Record<string, unknown> | undefined | null): string | undefined {
  if (!meta) return undefined;
  for (const key of CUSTOM_ID_KEYS) {
    const v = meta[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return undefined;
}

/** Minimal shape of a TwelveLabs search clip (SDK `SearchItem`, group_by=clip). */
export interface RawSearchClip {
  videoId?: string;
  start?: number;
  end?: number;
  rank?: number;
  thumbnailUrl?: string;
  userMetadata?: Record<string, unknown>;
}

/**
 * Map raw clips to SearchHits. Clips whose video has no ScorePlay id are DROPPED (never given a
 * fabricated id); their TwelveLabs video ids are returned in `unmapped` so callers can log them.
 */
export function mapSearchClips(
  clips: RawSearchClip[],
  resolveCustomId: (videoId: string, clip: RawSearchClip) => string | undefined,
  opts: { origin: DataOrigin; excludeMediaIds?: string[]; limit?: number },
): { hits: SearchHit[]; unmapped: string[] } {
  const exclude = new Set(opts.excludeMediaIds ?? []);
  const hits: SearchHit[] = [];
  const unmapped: string[] = [];
  for (const clip of clips) {
    if (!clip.videoId || typeof clip.start !== "number" || typeof clip.end !== "number") continue;
    const scoreplayMediaId = resolveCustomId(clip.videoId, clip);
    if (!scoreplayMediaId) {
      unmapped.push(clip.videoId);
      continue;
    }
    if (exclude.has(scoreplayMediaId)) continue;
    hits.push({
      scoreplayMediaId,
      twelvelabsVideoId: clip.videoId,
      start: clip.start,
      end: clip.end,
      rank: hits.length + 1, // re-ranked after drops; TwelveLabs order preserved
      ...(typeof clip.rank === "number" ? { score: clip.rank } : {}),
      ...(clip.thumbnailUrl ? { thumbnailUrl: clip.thumbnailUrl } : {}),
      origin: opts.origin,
    });
    if (opts.limit && hits.length >= opts.limit) break;
  }
  return { hits, unmapped };
}

// ---------- Pegasus structured observations ----------

export const OBSERVATION_CATEGORIES = ["sponsor_brand", "person", "broadcaster", "onscreen_graphic"] as const;

const LABEL_PREFIX: Record<(typeof OBSERVATION_CATEGORIES)[number], string> = {
  sponsor_brand: "brand",
  person: "person",
  broadcaster: "broadcaster",
  onscreen_graphic: "graphic",
};

/** Rubric questions adapted from twelvelabs_sampleprompts (NBA + PL), single_select with options. */
export const RUBRIC = {
  broadcast_source: ["national", "regional", "mixed_regional", "league_produced", "international_broadcaster", "no_game_footage", "unknown"],
  scorebug_watermark: ["present", "partially_removed", "clean_feed", "produced_feature", "no_game_action"],
  player_focus: ["group", "no_players", "single_player", "single_player_commercial"],
  gambling_brand: ["none", "incidental", "promotional"],
} as const;

/** JSON schema sent as `response_format.json_schema` (respects TwelveLabs schema limitations). */
export const PEGASUS_JSON_SCHEMA = {
  type: "object",
  properties: {
    observations: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: [...OBSERVATION_CATEGORIES] },
          entity: { type: "string" },
          start_time: { type: "timestamp", format: "seconds" },
          end_time: { type: "timestamp", format: "seconds" },
          description: { type: "string" },
          confidence: { type: "number" },
        },
        required: ["category", "entity", "start_time", "end_time", "description", "confidence"],
      },
    },
    rubric: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(RUBRIC).map(([k, opts]) => [k, { type: "string", enum: [...opts] }]),
      ),
      required: Object.keys(RUBRIC),
    },
    summary: { type: "string" },
  },
  required: ["observations", "rubric", "summary"],
} as const;

export const PEGASUS_PROMPT = `You are auditing a sports clip for media-rights clearance. Report only what you can actually see or hear; never infer from team, arena or context. Every observation MUST carry the start_time and end_time (seconds from the start of the video) during which it is visible or audible.

List observations of these categories:
- sponsor_brand: every sponsor or commercial brand mark — broadcast graphics, overlays, LED boards, prominent arena/stadium signage, logos on jerseys/kits or other team-controlled surfaces. Name the brand as written. Note in the description whether it is part of the live picture or added by the edit.
- person: every identifiable player, coach or person, identified only by name graphic, jersey/shirt name or number, or commentary. Say how they were identified.
- broadcaster: every network or broadcaster logo/bug, scorebug branding or mic flag. Only name a network you can see or hear named.
- onscreen_graphic: scorebugs, lower thirds, watermarks, title cards and other overlays (entity = short name of the graphic).

confidence = your confidence (0 to 1) that the observation is correct. Omit anything you are unsure exists.

Rubric (choose exactly one option each):
- broadcast_source: which broadcast network or production source the game footage comes from; "unknown" if game footage shows no network bug and no scorebug.
- scorebug_watermark: is game action shown with its broadcast scorebug / network watermark, or as a clean feed? Arena scoreboards and jumbotrons are NOT scorebugs.
- player_focus: is one player the clear focus, and is the clip framed as that player's endorsement?
- gambling_brand: is a gambling or betting brand shown, and is it part of the live picture (incidental) or promoted by the edit (promotional)?

summary: one paragraph for a rights reviewer: what the clip is and which rights questions it raises (sponsors, people, broadcaster, graphics).`;

const ObservationItemSchema = z.object({
  category: z.enum(OBSERVATION_CATEGORIES),
  entity: z.string().trim().min(1),
  start_time: z.coerce.number().nonnegative(),
  end_time: z.coerce.number().nonnegative(),
  description: z.string().trim().min(1),
  confidence: z.coerce.number().min(0).max(1),
});

const PegasusOutputSchema = z.object({
  observations: z.array(z.unknown()),
  rubric: z.record(z.string(), z.unknown()).optional(),
  summary: z.string().optional(),
});

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export class PegasusParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PegasusParseError";
  }
}

/**
 * Parse Pegasus JSON into Evidence. Whole-output malformation throws PegasusParseError; individual
 * malformed observations are dropped (reported in `dropped`). Nothing is synthesized.
 */
export function parsePegasusObservations(
  raw: string,
  scoreplayMediaId: string,
  origin: DataOrigin,
): { evidence: Evidence[]; dropped: number } {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new PegasusParseError("Pegasus output is not valid JSON (possibly truncated)");
  }
  const top = PegasusOutputSchema.safeParse(json);
  if (!top.success) throw new PegasusParseError(`Pegasus output has unexpected shape: ${top.error.message}`);

  const evidence: Evidence[] = [];
  let dropped = 0;
  for (const item of top.data.observations) {
    const p = ObservationItemSchema.safeParse(item);
    const slug = p.success ? slugify(p.data.entity) : "";
    if (!p.success || !slug || p.data.end_time < p.data.start_time) {
      dropped++;
      continue;
    }
    const o = p.data;
    evidence.push({
      scoreplayMediaId,
      start: o.start_time,
      end: o.end_time,
      observation: `${o.entity}: ${o.description}`,
      source: "TWELVELABS",
      label: `${LABEL_PREFIX[o.category]}:${slug}`,
      confidence: o.confidence,
      origin,
    });
  }

  const rubric = top.data.rubric ?? {};
  for (const [question, options] of Object.entries(RUBRIC)) {
    const answer = rubric[question];
    if (typeof answer === "string" && (options as readonly string[]).includes(answer)) {
      evidence.push({
        scoreplayMediaId,
        observation: `Rubric ${question}: ${answer}`,
        source: "TWELVELABS",
        label: `rubric:${question}:${answer}`,
        origin,
      });
    }
  }
  if (top.data.summary?.trim()) {
    evidence.push({ scoreplayMediaId, observation: top.data.summary.trim(), source: "TWELVELABS", label: "summary", origin });
  }
  return { evidence, dropped };
}
