/**
 * REROUTE ↔ ScorePlay writeback taxonomy.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ PENDING CONFIRMATION WITH SCOREPLAY STAFF (spec §1: agree the        │
 * │ tagging taxonomy before writeback). Every name below is a proposal.  │
 * │ Edit THIS object only; nothing else hard-codes these strings.        │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * Carriers (all documented, see API_NOTES.md):
 * - Media tags      → tag options attached with `POST /media/{id}/tags` (created via `POST /tag/options`).
 *                     Written ONLY for decisions under a VERIFIED (non-fictional) policy.
 * - Timecoded notes → video logs (`POST /video/logs`, offset range) whose `comment` carries status,
 *                     clearance, reasons, policy, receipt, reviewer and segment; `raw_tags` label them.
 * - `PUT /media/{id}/details` has no custom-field slot and would overwrite producer data → never used.
 */
import type { HumanReviewStatus, Verdict } from "@/lib/contracts";

export const SCOREPLAY_TAXONOMY = {
  status: "PENDING CONFIRMATION WITH SCOREPLAY STAFF",

  /** `type` sent when REROUTE creates a tag option (docs: e.g. metadata, free, credit, size). */
  tagOptionType: "free",

  /**
   * Per-media verdict under a VERIFIED policy. The `verified` segment makes the status explicit: a
   * ScorePlay filter on these tags can never return a fictional/demo result. Demo policies get NO tag.
   */
  verifiedVerdictTags: {
    ALLOWED: "reroute:verified:allowed",
    BLOCKED: "reroute:verified:blocked",
    NEEDS_REVIEW: "reroute:verified:needs-review",
  } satisfies Record<Verdict, string>,

  /** Human review outcome, written together with a verified verdict (live writes require a review). */
  reviewTags: {
    APPROVED: "reroute:review:approved",
    REJECTED: "reroute:review:rejected",
  } satisfies Record<Exclude<HumanReviewStatus, "PENDING">, string>,

  /**
   * Rights Passport summary tags (proposal — confirm with ScorePlay staff). Managed names only: the passport is
   * a Supabase/Databricks CDM view, and writeback never writes these for demo policies.
   */
  passportTags: {
    allow: "reroute:passport:allow",
    allowLimited: "reroute:passport:allow-limited",
    review: "reroute:passport:review",
    block: "reroute:passport:block",
    prefix: "reroute:passport:",
  },

  /** `raw_tags` on derivatives uploaded by REROUTE (distinct assets needing their own decision). */
  derivativeTag: "reroute:derivative",

  /** `raw_tags` on REROUTE video logs (docs: created if not existing). */
  logRawTags: {
    verified: ["reroute", "reroute:verified"],
    /** Informational only: a fictional demo policy result. Never a clearance. */
    demo: ["reroute", "reroute:demo-simulation"],
    /** No applicable verified policy was selected: informational only. */
    unverified: ["reroute", "reroute:unverified-policy"],
  },

  /**
   * Every REROUTE video-log comment starts with `${commentPrefix}${receiptId} |`.
   * This marker is how writeback finds its own logs again (read-back + superseded-log cleanup).
   */
  commentPrefix: "REROUTE receipt ",

  /** Reasons summarised per log comment (DENY first, then MISSING, then PERMIT). */
  maxReasonsPerLog: 3,

  /** Comment length cap. The real limit is undocumented (open question) — keep comments short. */
  maxCommentChars: 1000,

  /**
   * Rights facts read from media tags. A tag option counts as a fact of a kind when its ID is listed
   * under a tag filter (tag group, `GET /tag/filters`) whose name matches one of these (case-insensitive).
   * Team facts additionally come from tag options of `type: "team"` (documented on the Team schema).
   * Group names are org-specific → confirm the real names with ScorePlay staff.
   */
  factTagFilters: {
    competition: ["competition", "competitions", "league", "leagues"],
    team: ["team", "teams"],
  },
} as const;

export type ScorePlayTaxonomy = typeof SCOREPLAY_TAXONOMY;

/** Every tag-option name REROUTE manages on a media (a newer write supersedes the others). */
export function managedTagNames(): string[] {
  const t = SCOREPLAY_TAXONOMY;
  return [
    ...Object.values(t.verifiedVerdictTags),
    ...Object.values(t.reviewTags),
    t.passportTags.allow,
    t.passportTags.allowLimited,
    t.passportTags.review,
    t.passportTags.block,
  ];
}

/** Map overall L2 / decide verdict → passport summary tag. */
export function passportTagForVerdict(verdict: Verdict): string {
  const t = SCOREPLAY_TAXONOMY.passportTags;
  if (verdict === "ALLOWED") return t.allow;
  if (verdict === "BLOCKED") return t.block;
  return t.review;
}
