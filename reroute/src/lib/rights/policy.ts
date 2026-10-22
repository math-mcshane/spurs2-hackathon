/**
 * Declarative rights policy format. A rule reads as:
 *   "<effect> <dimensions> for assets matching <match>, when the publish intent matches <intent>,
 *    for publications dated within [validFrom, validUntil]."
 * PERMIT rules that grant `people`/`sponsor` must list which people/brands they cover (`covers`).
 */
import { z } from "zod";
import { DimensionSchema, UsageSchema } from "@/lib/contracts";

const NonEmptyList = z.array(z.string().min(1)).min(1);
const Timestamp = z.iso.datetime({ offset: true });

/** Which assets/segments a rule applies to. Every listed key must match (AND); values within a key are OR. */
export const RuleMatchSchema = z.strictObject({
  /** asset.facts.competition, e.g. "NBA". Unknown fact ⇒ rule applicability is uncertain. */
  competition: NonEmptyList.optional(),
  /** asset.facts.team. Unknown fact ⇒ rule applicability is uncertain. */
  team: NonEmptyList.optional(),
  /** Any asset tag (case-insensitive, trailing "*" = prefix). */
  assetTags: NonEmptyList.optional(),
  /** ScorePlay asset ids. */
  assetIds: NonEmptyList.optional(),
  /** Labels of evidence overlapping the segment, e.g. "brand:rival-sponsor", "person:*". */
  evidenceLabels: NonEmptyList.optional(),
});
export type RuleMatch = z.infer<typeof RuleMatchSchema>;

/** Publish-intent conditions. Every listed key must match (AND). */
export const RuleIntentSchema = z.strictObject({
  territories: NonEmptyList.optional(),
  platforms: NonEmptyList.optional(),
  usage: z.array(UsageSchema).min(1).optional(),
});
export type RuleIntent = z.infer<typeof RuleIntentSchema>;

export const RuleSchema = z
  .strictObject({
    id: z.string().min(1),
    effect: z.enum(["PERMIT", "DENY"]),
    dimensions: z.array(DimensionSchema).min(1),
    match: RuleMatchSchema,
    intent: RuleIntentSchema.optional(),
    /** People/brands covered by a PERMIT on `people`/`sponsor`: "person:*", "brand:acme", ... */
    covers: NonEmptyList.optional(),
    /** Rule only applies to publications dated within this window (license term / expiry). */
    validFrom: Timestamp.optional(),
    validUntil: Timestamp.optional(),
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
      if (!/^(person|brand):/i.test(pattern)) {
        ctx.addIssue({ code: "custom", path: ["covers"], message: `covers entry "${pattern}" must start with person: or brand:` });
      }
    }
    if (rule.validFrom && rule.validUntil && Date.parse(rule.validFrom) > Date.parse(rule.validUntil)) {
      ctx.addIssue({ code: "custom", path: ["validUntil"], message: "validUntil is before validFrom" });
    }
  });
export type Rule = z.infer<typeof RuleSchema>;

export const PolicySchema = z
  .strictObject({
    id: z.string().min(1),
    version: z.string().min(1),
    /** Where the rules come from (document, organizer dataset, or "fictional demo"). */
    source: z.string().min(1),
    fictional: z.boolean(),
    disclaimer: z.string(),
    rules: z.array(RuleSchema),
  })
  .superRefine((policy, ctx) => {
    if (policy.fictional && !policy.disclaimer.includes("FICTIONAL DEMO POLICY")) {
      ctx.addIssue({ code: "custom", path: ["disclaimer"], message: 'Fictional policies must say "FICTIONAL DEMO POLICY"' });
    }
    const seen = new Set<string>();
    policy.rules.forEach((rule, i) => {
      if (seen.has(rule.id)) ctx.addIssue({ code: "custom", path: ["rules", i, "id"], message: `Duplicate rule id ${rule.id}` });
      seen.add(rule.id);
    });
  });
export type Policy = z.infer<typeof PolicySchema>;
