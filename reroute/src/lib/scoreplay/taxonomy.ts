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
 * - Timecoded notes → video logs (`POST /video/logs`, offset range / offset single) whose `comment`
 *                     carries rule, reasoning, policy, intent and receipt id; `raw_tags` label them.
 * - The documented `PUT /media/{id}/details` has no custom-field slot, so REROUTE never writes there
 *   (overwriting the producer's `description` would destroy their data).
 */
import type { HumanReviewStatus, Verdict } from "@/lib/contracts";

export const SCOREPLAY_TAXONOMY = {
  status: "PENDING CONFIRMATION WITH SCOREPLAY STAFF",

  /** `type` sent when REROUTE creates a tag option (docs: free-form; common values metadata, free, credit, size). */
  tagOptionType: "free",

  /** Exactly one verdict tag is kept on a media: the verdict of the latest REROUTE writeback. */
  verdictTags: {
    ALLOWED: "reroute:verdict:allowed",
    BLOCKED: "reroute:verdict:blocked",
    NEEDS_REVIEW: "reroute:verdict:needs-review",
  } satisfies Record<Verdict, string>,

  /** Exactly one human-review tag is kept on a media. */
  reviewTags: {
    PENDING: "reroute:review:pending",
    APPROVED: "reroute:review:approved",
    REJECTED: "reroute:review:rejected",
  } satisfies Record<HumanReviewStatus, string>,

  /** Added when the deciding policy is fictional demo data; removed otherwise. */
  fictionalPolicyTag: "reroute:policy:fictional-demo",

  /** Added to derivatives uploaded by REROUTE (distinct assets needing their own decision). */
  derivativeTag: "reroute:derivative",

  /** `raw_tags` on every REROUTE video log (docs: created if not existing). */
  logRawTags: {
    summary: ["reroute", "reroute:summary"],
    DENY: ["reroute", "reroute:blocked-range"],
    MISSING: ["reroute", "reroute:review-range"],
  },

  /**
   * Every REROUTE video-log comment starts with `${commentPrefix}${receiptId} |`.
   * This marker is how writeback finds its own logs again (idempotency + read-back).
   */
  commentPrefix: "REROUTE receipt ",

  /** Banner written into every comment produced under a fictional policy (spec §8). */
  fictionalBanner: "FICTIONAL DEMO POLICY",

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

/** Every tag-option name REROUTE manages on a media (used to diff/remove stale ones). */
export function managedTagNames(): string[] {
  const t = SCOREPLAY_TAXONOMY;
  return [...Object.values(t.verdictTags), ...Object.values(t.reviewTags), t.fictionalPolicyTag];
}
