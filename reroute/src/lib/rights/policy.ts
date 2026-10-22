/**
 * Declarative rights policy format.
 *
 * A policy applies to footage of ONE club (`applicability`): publisher club, competitions, ScorePlay
 * provenance and a validity term. Selection (`select.ts`) never evaluates footage under another club's policy.
 *
 * A rule reads as:
 *   "<effect> <dimensions> for assets matching <match>, when the publish intent matches <intent>,
 *    for publications dated within [validFrom, validUntil]."
 * PERMIT rules that grant `people`/`sponsor` must say whom they cover (`covers`, possibly empty).
 */
import { z } from "zod";
import { DimensionSchema, UsageSchema } from "@/lib/contracts";

const NonEmptyList = z.array(z.string().min(1)).min(1);
const Timestamp = z.iso.datetime({ offset: true });

/** VERIFIED = sourced from a real, verified agreement; DEMO = fictional (never authorizes publication). */
export const PolicyKindSchema = z.enum(["VERIFIED", "DEMO"]);
export type PolicyKind = z.infer<typeof PolicyKindSchema>;

/** Which assets/segments a rule applies to. Every listed key must match (AND); values within a key are OR. */
export const RuleMatchSchema = z.strictObject({
  /** asset.facts.competition, e.g. "NBA". Unknown fact ⇒ rule applicability is uncertain. */
  competition: NonEmptyList.optional(),
  /** Any club in asset.facts.teams. Unknown fact ⇒ rule applicability is uncertain. */
  team: NonEmptyList.optional(),
  /** Any asset tag (case-insensitive, trailing "*" = prefix). */
  assetTags: NonEmptyList.optional(),
  /** ScorePlay asset ids. */
  assetIds: NonEmptyList.optional(),
  /**
   * Labels of evidence overlapping the segment, e.g. "brand:*", "rubric:player_focus:no_players".
   * Without usable video analysis an evidence condition is uncertain (unless HUMAN evidence settles it).
   */
  evidenceLabels: NonEmptyList.optional(),
  /** Evidence labels that never trigger the rule (e.g. official partners in a third-party-brand DENY). */
  evidenceLabelsExcept: NonEmptyList.optional(),
  /** true = ScorePlay lists no player for the asset. */
  noListedPeople: z.literal(true).optional(),
  /** true = a person in the segment is registered (ScorePlay squad) to a club other than the policy's club. */
  otherClubPeople: z.literal(true).optional(),
});
export type RuleMatch = z.infer<typeof RuleMatchSchema>;

/** Publish-intent conditions. Every listed key must match (AND). */
export const RuleIntentSchema = z.strictObject({
  territories: NonEmptyList.optional(),
  /** Rule applies to every territory EXCEPT these (e.g. a geo-restriction outside the licensed home market). */
  exceptTerritories: NonEmptyList.optional(),
  platforms: NonEmptyList.optional(),
  usage: z.array(UsageSchema).min(1).optional(),
});
export type RuleIntent = z.infer<typeof RuleIntentSchema>;

/** Keys of `match` that tie a rule to particular footage (vs. to the publish intent). */
export const ASSET_BOUND_MATCH_KEYS = ["team", "assetTags", "assetIds", "evidenceLabels", "noListedPeople", "otherClubPeople"] as const;

/** `covers` entries: "person:<slug|*>", "brand:<slug|*>", or "squad:own" (people ScorePlay registers in the policy club's squad). */
const COVER_PATTERN = /^(person:|brand:|squad:own$)/i;

export const RuleSchema = z
  .strictObject({
    id: z.string().min(1),
    effect: z.enum(["PERMIT", "DENY"]),
    dimensions: z.array(DimensionSchema).min(1),
    match: RuleMatchSchema,
    intent: RuleIntentSchema.optional(),
    covers: z.array(z.string().min(1)).optional(),
    /** Rule only applies to publications dated within this window (license term / expiry). */
    validFrom: Timestamp.optional(),
    validUntil: Timestamp.optional(),
    /** Human-readable; shown verbatim to producers and reviewers. */
    explanation: z.string().min(1),
  })
  .superRefine((rule, ctx) => {
    const grantsSubjects = rule.dimensions.some((d) => d === "people" || d === "sponsor");
    if (rule.effect === "PERMIT" && grantsSubjects && !rule.covers) {
      ctx.addIssue({ code: "custom", path: ["covers"], message: "PERMIT on people/sponsor must list `covers`" });
    }
    if (rule.effect === "PERMIT" && rule.dimensions.includes("expiry") && !rule.validUntil) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "PERMIT on expiry must set `validUntil`" });
    }
    for (const pattern of rule.covers ?? []) {
      if (!COVER_PATTERN.test(pattern)) {
        ctx.addIssue({ code: "custom", path: ["covers"], message: `covers entry "${pattern}" must be person:…, brand:… or squad:own` });
      }
    }
    if (rule.intent?.territories && rule.intent.exceptTerritories) {
      ctx.addIssue({ code: "custom", path: ["intent"], message: "Use either territories or exceptTerritories" });
    }
    if (rule.validFrom && rule.validUntil && Date.parse(rule.validFrom) > Date.parse(rule.validUntil)) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "validUntil is before validFrom" });
    }
  });
export type Rule = z.infer<typeof RuleSchema>;

export const ApplicabilitySchema = z.strictObject({
  /** Publishing club (CLUBS key, e.g. "tottenham"); must equal `PublishIntent.club`. */
  club: z.string().min(1),
  /** How ScorePlay names the club in tags/squads; every asset must be tagged with one of them. */
  clubNames: NonEmptyList,
  competitions: NonEmptyList,
  /** Where the footage must come from to fall under this policy. */
  provenance: z
    .strictObject({
      /** Every asset must carry ALL of these ScorePlay tags. */
      requiredTags: NonEmptyList,
      description: z.string().min(1),
    })
    .optional(),
  /** Term of the agreement; publications dated outside it are not licensed. */
  validFrom: Timestamp,
  validUntil: Timestamp,
});
export type Applicability = z.infer<typeof ApplicabilitySchema>;

export const PolicySchema = z
  .strictObject({
    id: z.string().min(1),
    version: z.string().min(1),
    title: z.string().min(1),
    /** Where the rules come from (document, organizer dataset, or "fictional demo"). */
    source: z.string().min(1),
    kind: PolicyKindSchema,
    disclaimer: z.string(),
    applicability: ApplicabilitySchema,
    rules: z.array(RuleSchema),
  })
  .superRefine((policy, ctx) => {
    if (policy.kind === "DEMO" && !policy.disclaimer.includes("FICTIONAL DEMO POLICY")) {
      ctx.addIssue({ code: "custom", path: ["disclaimer"], message: 'Demo policies must say "FICTIONAL DEMO POLICY"' });
    }
    if (Date.parse(policy.applicability.validFrom) > Date.parse(policy.applicability.validUntil)) {
      ctx.addIssue({ code: "custom", path: ["applicability", "validUntil"], message: "validUntil is before validFrom" });
    }
    const seen = new Set<string>();
    policy.rules.forEach((rule, i) => {
      if (seen.has(rule.id)) ctx.addIssue({ code: "custom", path: ["rules", i, "id"], message: `Duplicate rule id ${rule.id}` });
      seen.add(rule.id);
    });
  });
export type Policy = z.infer<typeof PolicySchema>;
