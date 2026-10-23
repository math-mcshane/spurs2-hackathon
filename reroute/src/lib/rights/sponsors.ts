import type { Policy } from "./policy";
import { PRESET_POLICIES } from "./registry";

/**
 * Brand names as the rule packages describe them. Pure (no server imports) so the objective parser can recognise
 * a partner the user names, and the Policy Center can list a package's partners, from the same reading.
 */

const unique = <T>(xs: readonly T[]) => [...new Set(xs)];
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** "Tottenham Hotspur FC" → "thfc" (all-caps words kept whole), "San Antonio Spurs" → "sas". */
const acronym = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 1 && w === w.toUpperCase() ? w : w[0]))
    .join("")
    .toLowerCase();

/** The club's own marks (club name, its acronym, a nickname inside the name such as "spurs" in "Hotspur"). */
function isOwnMark(brand: string, policy: Policy): boolean {
  const a = policy.applicability;
  const names = a.clubNames.map(slug);
  if (brand === slug(a.club) || names.includes(brand) || a.clubNames.some((n) => acronym(n) === brand)) return true;
  const stem = brand.replace(/s$/, "");
  return stem.length >= 4 && names.some((n) => n.includes(stem));
}

/** "aia" → "AIA", "thfc" → "THFC", "kraken" → "Kraken", "red-bull" → "Red Bull" (short or vowel-less words read as acronyms). */
export const brandName = (s: string) =>
  s
    .split("-")
    .filter(Boolean)
    .map((w) => (w.length <= 3 || !/[aeiou]/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

/** Partners a package names explicitly in a sponsor PERMIT rule (club marks and "every brand" wildcards excluded). */
export function partnersOf(policy: Policy): string[] {
  const brands = policy.rules
    .filter((r) => r.effect === "PERMIT" && r.dimensions.includes("sponsor"))
    .flatMap((r) => r.covers ?? [])
    .filter((c) => /^brand:/i.test(c))
    .map((c) => slug(c.slice("brand:".length).replace(/\*$/, "")))
    .filter((b) => b !== "" && !isOwnMark(b, policy));
  return unique(brands).map(brandName);
}

/** Every partner any bundled preset names (e.g. AIA, Nike, Kraken): what a goal can name as its target sponsor. */
export const KNOWN_PARTNER_BRANDS: readonly string[] = unique(PRESET_POLICIES.flatMap(partnersOf));
