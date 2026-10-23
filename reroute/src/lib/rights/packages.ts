import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Dimension, Usage } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { ClubSchema, type PolicyContext } from "@/features/pulse/types";
import { events, policyPackages } from "@/lib/server/repositories";
import type { PolicySelectionRecord, StoredPolicyPackage, UploadedPolicySourceType } from "@/lib/server/repositories";
import { ASSET_BOUND_MATCH_KEYS, PolicySchema, type Policy, type Rule } from "./policy";
import { PRESET_POLICIES, SAMPLE_UPLOAD_POLICY } from "./registry";

/**
 * Policy Center: the library of rule packages a campaign can be evaluated against.
 *
 * - Presets are bundled (`registry.ts`); uploaded packages are stored (`reroute_policy_packages`).
 * - Every package is a DEMO: presets are fictional and an upload is forced to DEMO whatever its JSON says, so
 *   nothing from this library can ever make `canPublish()` true.
 * - Each club has one workspace default (stored selection, else its first preset). A run may pick another
 *   package of the same club; `policiesForEvaluation` hands the engine exactly ONE package per club.
 * - Without the tables (a deployment whose database was not migrated) presets still work; uploads and the
 *   workspace default answer NOT_CONFIGURED.
 * - The example upload file is also bundled as a SAMPLE_DOCUMENT_MAPPING package: its rules were mapped in
 *   advance (no document extraction). It is always in the library — on a deployment without the tables,
 *   importing the example file confirms it and a campaign can select it like any package.
 */

export type PolicyPackageSourceType = "PRESET" | UploadedPolicySourceType;

export interface PolicyPackageSummary {
  id: string;
  version: string;
  title: string;
  club: string;
  kind: "VERIFIED" | "DEMO";
  sourceType: PolicyPackageSourceType;
  /** Only a VERIFIED preset; never an upload. */
  verified: boolean;
  /** = kind === "DEMO". */
  fictional: boolean;
  label: string;
  /** Licensed values, from PERMIT rules not tied to particular footage. */
  territories: string[];
  /** Licensed markets per use, when they differ between uses (e.g. sales posts home market only). */
  territoriesByUsage?: Partial<Record<Usage, string[]>>;
  platforms: string[];
  usages: Usage[];
  /** Official partners a sponsored/sales post may show (the club's own marks excluded). */
  partners: string[];
  validFrom: string;
  validUntil: string;
  uploadedBy?: string;
  uploadedAt?: string;
  fileName?: string;
  sha256?: string;
  warnings: string[];
  competitions: string[];
  provenance?: string;
  source: string;
  disclaimer: string;
}

/** A library package: what the UI shows (`summary`) and what the engine evaluates (`policy`). */
export type PolicyPackage = { summary: PolicyPackageSummary; policy: Policy };

export const PRESET_LABEL = "Demo policy — not verified legal clearance";
export const UPLOAD_LABEL = "Uploaded rules — unverified, demo only";
export const SAMPLE_LABEL = "Sample mapping — rules prepared from the example file, not extracted from a document";
export const SAMPLE_FILE_NAME = "tottenham-international-window.sample.json";
export const UPLOADS_NOT_CONFIGURED = "Policy uploads are not set up on this deployment";
export const MAX_UPLOAD_BYTES = 200 * 1024;

const DAY_MS = 86_400_000;
const EXPIRY_WARNING_DAYS = 30;

// ---------- Summaries ----------

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const formatDate = (iso: string) => DATE.format(new Date(iso));

const isAssetBound = (rule: Rule) => ASSET_BOUND_MATCH_KEYS.some((k) => rule.match[k] !== undefined);
const unique = <T>(xs: readonly T[]) => [...new Set(xs)];
const slug = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function licensed(policy: Policy, dimension: "territory" | "platform" | "usage"): string[] {
  const key = dimension === "territory" ? "territories" : dimension === "platform" ? "platforms" : "usage";
  return unique(
    policy.rules.filter((r) => r.effect === "PERMIT" && r.dimensions.includes(dimension) && !isAssetBound(r)).flatMap((r) => r.intent?.[key] ?? []),
  );
}

/** Markets licensed for each use; undefined when every use gets the same markets. */
function territoriesByUsage(policy: Policy, usages: readonly Usage[]): Partial<Record<Usage, string[]>> | undefined {
  const rules = policy.rules.filter((r) => r.effect === "PERMIT" && r.dimensions.includes("territory") && !isAssetBound(r));
  const byUsage = Object.fromEntries(
    usages.map((u) => [u, unique(rules.filter((r) => !r.intent?.usage || r.intent.usage.includes(u)).flatMap((r) => r.intent?.territories ?? []))]),
  ) as Partial<Record<Usage, string[]>>;
  const shapes = new Set(Object.values(byUsage).map((t) => t!.join(",")));
  return shapes.size > 1 ? byUsage : undefined;
}

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
const brandName = (s: string) =>
  s
    .split("-")
    .filter(Boolean)
    .map((w) => (w.length <= 3 || !/[aeiou]/.test(w) ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1)))
    .join(" ");

function partnersOf(policy: Policy): string[] {
  const brands = policy.rules
    .filter((r) => r.effect === "PERMIT" && r.dimensions.includes("sponsor"))
    .flatMap((r) => r.covers ?? [])
    .filter((c) => /^brand:/i.test(c))
    .map((c) => slug(c.slice("brand:".length).replace(/\*$/, "")))
    .filter((b) => b !== "" && !isOwnMark(b, policy));
  return unique(brands).map(brandName);
}

const TOPIC: Record<Dimension, string> = {
  territory: "market",
  platform: "channel",
  usage: "type of use",
  competition: "competition",
  people: "people on screen",
  sponsor: "brands on screen",
  expiry: "licence dates",
};

function warningsOf(policy: Policy, uploaded: { by?: string } | null, now: Date): string[] {
  const out: string[] = [];
  if (uploaded) out.push(`Uploaded${uploaded.by ? ` by ${uploaded.by}` : ""} — these rules are unverified and only usable as a demo.`);
  const permitted = new Set(policy.rules.filter((r) => r.effect === "PERMIT").flatMap((r) => r.dimensions));
  if (!permitted.has("territory")) out.push("No territory rule — no market is licensed, so every use will need review.");
  if (!permitted.has("expiry")) out.push("No expiry rule — the licence term can't be confirmed, so every use will need review.");
  for (const d of ["platform", "usage", "competition", "people", "sponsor"] as const) {
    if (!permitted.has(d)) out.push(`No rule grants ${TOPIC[d]} — every use will need review.`);
  }
  const until = Date.parse(policy.applicability.validUntil);
  const from = Date.parse(policy.applicability.validFrom);
  if (until < now.getTime()) out.push(`Expired on ${formatDate(policy.applicability.validUntil)} — no publication date is covered.`);
  else if (until - now.getTime() <= EXPIRY_WARNING_DAYS * DAY_MS) out.push(`Expires on ${formatDate(policy.applicability.validUntil)} — within ${EXPIRY_WARNING_DAYS} days.`);
  if (from > now.getTime()) out.push(`Not in force until ${formatDate(policy.applicability.validFrom)}.`);
  return out;
}

type Origin =
  | { sourceType: "PRESET" }
  | { sourceType: "SAMPLE_DOCUMENT_MAPPING"; bundled: true }
  | { sourceType: UploadedPolicySourceType; stored: StoredPolicyPackage };

function toPackage(policy: Policy, origin: Origin, now: Date = new Date()): PolicyPackage {
  const stored = "stored" in origin ? origin.stored : null;
  const sample = "bundled" in origin;
  const a = policy.applicability;
  const usages = licensed(policy, "usage") as Usage[];
  const summary: PolicyPackageSummary = {
    id: policy.id,
    version: policy.version,
    title: policy.title,
    club: a.club,
    kind: stored ? "DEMO" : policy.kind,
    sourceType: origin.sourceType,
    verified: !stored && policy.kind === "VERIFIED",
    fictional: stored ? true : policy.kind === "DEMO",
    label: stored ? UPLOAD_LABEL : sample ? SAMPLE_LABEL : policy.kind === "DEMO" ? PRESET_LABEL : "Verified agreement",
    territories: licensed(policy, "territory"),
    territoriesByUsage: territoriesByUsage(policy, usages),
    platforms: licensed(policy, "platform"),
    usages,
    partners: partnersOf(policy),
    validFrom: a.validFrom,
    validUntil: a.validUntil,
    uploadedBy: stored?.uploadedBy,
    uploadedAt: stored?.createdAt,
    fileName: stored?.fileName ?? (sample ? SAMPLE_FILE_NAME : undefined),
    sha256: stored?.sha256,
    warnings: warningsOf(policy, stored && { by: stored.uploadedBy }, now),
    competitions: a.competitions,
    provenance: a.provenance?.description,
    source: policy.source,
    disclaimer: policy.disclaimer,
  };
  return { summary, policy };
}

export function toPolicyContext(summary: PolicyPackageSummary): PolicyContext {
  return {
    packageId: summary.id,
    version: summary.version,
    title: summary.title,
    club: summary.club,
    kind: summary.kind,
    sourceType: summary.sourceType,
    verified: summary.verified,
    label: summary.label,
  };
}

// ---------- Storage (degrades when the tables are missing) ----------

const notConfigured = (err: unknown) => err instanceof AppError && err.code === "NOT_CONFIGURED";

/** Reads: without the tables there simply are no uploads / stored selections. */
async function optional<T>(read: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await read();
  } catch (err) {
    if (notConfigured(err)) return fallback;
    throw err;
  }
}

/** Writes: without the tables, say so plainly. */
async function required<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (err) {
    if (notConfigured(err)) throw new AppError("NOT_CONFIGURED", UPLOADS_NOT_CONFIGURED, { cause: err });
    throw err;
  }
}

function fromStored(row: StoredPolicyPackage, now?: Date): PolicyPackage | null {
  const parsed = PolicySchema.safeParse(row.document);
  if (!parsed.success || parsed.data.kind !== "DEMO") {
    console.error(`[reroute] stored policy package ${row.id}@${row.version} no longer validates; skipped`);
    return null;
  }
  return toPackage(parsed.data, { sourceType: row.sourceType, stored: row }, now);
}

/** The bundled sample mapping (the example upload file, mapped in advance). */
const samplePackage = (now?: Date) => toPackage(SAMPLE_UPLOAD_POLICY, { sourceType: "SAMPLE_DOCUMENT_MAPPING", bundled: true }, now);

/** Same rules as the bundled example file (both sides parsed by PolicySchema, so key order is canonical). */
const isBundledSample = (policy: Policy) => JSON.stringify(policy) === JSON.stringify(SAMPLE_UPLOAD_POLICY);

async function resolvePackage(id: string, version?: string, now?: Date): Promise<PolicyPackage | null> {
  const preset = PRESET_POLICIES.find((p) => p.id === id);
  if (preset) return toPackage(preset, { sourceType: "PRESET" }, now);
  const row = await optional(() => policyPackages.get(id, version), null);
  if (row) return fromStored(row, now);
  return id === SAMPLE_UPLOAD_POLICY.id && (!version || version === SAMPLE_UPLOAD_POLICY.version) ? samplePackage(now) : null;
}

async function defaultPackage(club: string, now?: Date): Promise<PolicyPackage | null> {
  const selection = await optional<PolicySelectionRecord | null>(() => policyPackages.getSelection(club), null);
  if (selection) {
    const selected = await resolvePackage(selection.packageId, selection.packageVersion, now);
    if (selected && selected.summary.club === club) return selected;
  }
  const preset = PRESET_POLICIES.find((p) => p.applicability.club === club);
  return preset ? toPackage(preset, { sourceType: "PRESET" }, now) : null;
}

// ---------- Library ----------

export type PolicyLibrary = {
  packages: PolicyPackageSummary[];
  /** club → id of the workspace default package. */
  defaults: Record<string, string>;
  /** false = the policy tables are missing on this deployment (presets only). */
  uploadsAvailable: boolean;
};

export async function policyLibrary(now: Date = new Date()): Promise<PolicyLibrary> {
  let uploadsAvailable = true;
  let rows: StoredPolicyPackage[] = [];
  try {
    rows = await policyPackages.list();
  } catch (err) {
    if (!notConfigured(err)) throw err;
    uploadsAvailable = false;
  }
  // Only clubs PULSE serves (uploads are validated against them; other rows are repository test fixtures).
  const clubRows = rows.filter((row) => ClubSchema.safeParse(row.club).success);
  const newest = clubRows.filter((row, i) => clubRows.findIndex((r) => r.id === row.id) === i);
  const uploaded = newest.map((row) => fromStored(row, now)).filter((p): p is PolicyPackage => p !== null);
  const presets = PRESET_POLICIES.map((p) => toPackage(p, { sourceType: "PRESET" }, now));
  // The bundled sample mapping, unless the same package was uploaded into the tables.
  const sample = uploaded.some((p) => p.summary.id === SAMPLE_UPLOAD_POLICY.id) ? [] : [samplePackage(now)];
  const packages = [...presets, ...uploaded, ...sample];
  const clubs = unique(packages.map((p) => p.summary.club));
  const defaults: Record<string, string> = {};
  for (const [club, pkg] of await Promise.all(clubs.map(async (c) => [c, await defaultPackage(c, now)] as const))) {
    if (pkg) defaults[club] = pkg.summary.id;
  }
  return { packages: packages.map((p) => p.summary), defaults, uploadsAvailable };
}

export async function listPolicyPackages(): Promise<PolicyPackageSummary[]> {
  return (await policyLibrary()).packages;
}

export async function getPolicyPackage(id: string): Promise<PolicyPackage | null> {
  return resolvePackage(id);
}

export async function defaultPackageFor(club: string): Promise<PolicyPackageSummary | null> {
  const pkg = await defaultPackage(club);
  return pkg && pkg.summary;
}

/**
 * The candidate policies for one evaluation: exactly ONE package for `choice.club` (the requested package
 * if it exists and belongs to that club, else the club's default) plus the default package of every other
 * club. `package` = the package used for `choice.club` (null when the club has none).
 */
export async function policiesForEvaluation(choice: {
  club: string;
  packageId?: string;
}): Promise<{ policies: Policy[]; package: PolicyPackageSummary | null }> {
  const requested = choice.packageId ? await resolvePackage(choice.packageId) : null;
  const own = requested && requested.summary.club === choice.club ? requested : await defaultPackage(choice.club);
  const otherClubs = unique(PRESET_POLICIES.map((p) => p.applicability.club)).filter((c) => c !== choice.club);
  const others = await Promise.all(otherClubs.map((c) => defaultPackage(c)));
  const used = [own, ...others].filter((p): p is PolicyPackage => p !== null);
  return { policies: used.map((p) => p.policy), package: own && own.summary };
}

// ---------- Plain-language rules ----------

export type PlainRule = {
  id: string;
  effect: "PERMIT" | "DENY";
  /** What the rule is about, e.g. ["Market"]. */
  topics: string[];
  /** The rule's own explanation, verbatim. */
  text: string;
  /** When it applies, in words ("Uses: sponsored, sales"). */
  conditions: string[];
  /** Publication window of the rule itself, if any. */
  term?: string;
};

const USAGE_WORD: Record<string, string> = { EDITORIAL: "editorial", ORGANIC: "organic", SPONSORED: "sponsored", COMMERCIAL: "sales" };
const CHANNEL: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", x: "X", youtube: "YouTube", tiktok: "TikTok" };

/** "brand:*" → "any brand", "brand:aia*" → "AIA", "rubric:player_focus:no_players" → "no players in shot". */
function labelWords(label: string): string {
  if (/^rubric:player_focus:no_players$/i.test(label)) return "no players in shot";
  const [kind, ...rest] = label.split(":");
  const value = rest.join(":").replace(/\*$/, "");
  if (!value) return kind === "brand" ? "any brand" : kind === "person" ? "any person" : `any ${kind}`;
  return kind === "brand" ? brandName(slug(value)) : value.replace(/[_-]+/g, " ");
}

function coverWords(covers: readonly string[]): string {
  if (covers.length === 0) return "no identifiable person";
  return covers
    .map((c) => (/^squad:own$/i.test(c) ? "the club's own squad" : c === "person:*" ? "anyone" : labelWords(c)))
    .join(", ");
}

export function describeRule(rule: Rule): PlainRule {
  const m = rule.match;
  const i = rule.intent;
  const conditions: string[] = [];
  if (m.competition) conditions.push(`Competition: ${m.competition.join(", ")}`);
  if (m.team) conditions.push(`Footage of: ${m.team.join(", ")}`);
  if (m.assetTags) conditions.push(`Footage tagged: ${m.assetTags.join(", ")}`);
  if (m.assetIds) conditions.push(`Only ${m.assetIds.length} named clip${m.assetIds.length === 1 ? "" : "s"}`);
  if (m.noListedPeople) conditions.push("ScorePlay lists no player");
  if (m.otherClubPeople) conditions.push("A player from another club is on screen");
  if (m.evidenceLabels) conditions.push(`Seen on screen: ${m.evidenceLabels.map(labelWords).join(", ")}`);
  if (m.evidenceLabelsExcept) conditions.push(`Except: ${m.evidenceLabelsExcept.map(labelWords).join(", ")}`);
  if (i?.territories) conditions.push(`Markets: ${i.territories.join(", ")}`);
  if (i?.exceptTerritories) conditions.push(`Every market except ${i.exceptTerritories.join(", ")}`);
  if (i?.platforms) conditions.push(`Channels: ${i.platforms.map((p) => CHANNEL[p] ?? p).join(", ")}`);
  if (i?.usage) conditions.push(`Uses: ${i.usage.map((u) => USAGE_WORD[u] ?? u.toLowerCase()).join(", ")}`);
  if (rule.covers) conditions.push(`Covers: ${coverWords(rule.covers)}`);
  const term =
    rule.validFrom || rule.validUntil
      ? `${rule.validFrom ? formatDate(rule.validFrom) : "…"} – ${rule.validUntil ? formatDate(rule.validUntil) : "…"}`
      : undefined;
  const topics = rule.dimensions.map((d) => TOPIC[d][0].toUpperCase() + TOPIC[d].slice(1));
  return { id: rule.id, effect: rule.effect, topics, text: rule.explanation, conditions, term };
}

// ---------- Upload + workspace default ----------

const DEMO_PHRASE = "FICTIONAL DEMO POLICY";

export type UploadInput = { text: string; fileName?: string; uploadedBy: string };

/**
 * Validates and stores an uploaded JSON rule package. The stored package is ALWAYS kind DEMO (a declared
 * VERIFIED is downgraded and noted) and carries the demo disclaimer. Returns notes about what was changed and
 * whether it was stored. Without the policy tables, the bundled example file resolves to the bundled sample
 * mapping (`stored: false`); any other valid file is refused with NOT_CONFIGURED after full validation.
 */
export async function uploadPolicyPackage(
  input: UploadInput,
  now: Date = new Date(),
): Promise<{ package: PolicyPackageSummary; notes: string[]; stored: boolean }> {
  if (Buffer.byteLength(input.text, "utf8") > MAX_UPLOAD_BYTES) {
    throw new AppError("BAD_REQUEST", `The rule package is larger than ${MAX_UPLOAD_BYTES / 1024} KB`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(input.text);
  } catch {
    throw new AppError("BAD_REQUEST", "The file is not valid JSON");
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new AppError("BAD_REQUEST", "The rule package must be a JSON object");
  const doc = raw as Record<string, unknown>;
  const notes: string[] = [];
  if (doc.kind !== "DEMO") notes.push(`The file declared kind ${JSON.stringify(doc.kind ?? null)}; it is stored as DEMO — an upload can never be verified clearance.`);
  const disclaimer = typeof doc.disclaimer === "string" ? doc.disclaimer : "";
  const normalized = {
    ...doc,
    kind: "DEMO",
    disclaimer: disclaimer.includes(DEMO_PHRASE)
      ? disclaimer
      : `${DEMO_PHRASE} — uploaded rule package, unverified. DEMO POLICY — NOT VERIFIED LEGAL CLEARANCE.${disclaimer ? ` Original note: ${disclaimer}` : ""}`,
  };
  if (!disclaimer.includes(DEMO_PHRASE)) notes.push("A demo disclaimer was added.");
  const parsed = PolicySchema.safeParse(normalized);
  if (!parsed.success) throw new AppError("BAD_REQUEST", `The rule package does not match the policy format:\n${z.prettifyError(parsed.error)}`);
  const policy = parsed.data;
  if (!ClubSchema.safeParse(policy.applicability.club).success) {
    throw new AppError("BAD_REQUEST", `Unknown club "${policy.applicability.club}" (expected one of ${ClubSchema.options.join(", ")})`);
  }
  if (PRESET_POLICIES.some((p) => p.id === policy.id)) {
    throw new AppError("CONFLICT", `"${policy.id}" is a built-in package; give the uploaded package its own id`);
  }
  let existing: StoredPolicyPackage | null;
  try {
    existing = await required(() => policyPackages.get(policy.id));
  } catch (err) {
    if (!notConfigured(err)) throw err;
    if (isBundledSample(policy)) {
      return {
        package: samplePackage(now).summary,
        notes: ["This is the bundled example file. This deployment does not store uploads, so PULSE uses the example's prepared sample mapping — the same rules, validated."],
        stored: false,
      };
    }
    throw new AppError(
      "NOT_CONFIGURED",
      `The file is a valid rule package (${policy.rules.length} rules for ${policy.applicability.club}), but this deployment cannot store uploads. Try the example file.`,
      { cause: err },
    );
  }
  if (existing && existing.club !== policy.applicability.club) {
    throw new AppError("CONFLICT", `"${policy.id}" already belongs to a ${existing.club} package; use another id`);
  }
  // Re-importing the exact same version is a no-op, not an error (re-parsed: the database may reorder JSON keys).
  const same = existing?.version === policy.version ? PolicySchema.safeParse(existing.document) : null;
  if (existing && same?.success && JSON.stringify(same.data) === JSON.stringify(policy)) {
    const pkg = fromStored(existing, now);
    if (pkg) return { package: pkg.summary, notes: ["This version is already in the library."], stored: true };
  }
  const sha256 = createHash("sha256").update(input.text, "utf8").digest("hex");
  const stored = await required(() =>
    policyPackages.insert({
      id: policy.id,
      version: policy.version,
      club: policy.applicability.club,
      title: policy.title,
      kind: "DEMO",
      sourceType: "UPLOADED_JSON",
      document: policy,
      fileName: input.fileName,
      sha256,
      uploadedBy: input.uploadedBy,
    }),
  );
  await events.append({
    subjectType: "policy_package",
    subjectId: policy.id,
    type: "POLICY_UPLOADED",
    actor: input.uploadedBy,
    payload: {
      id: policy.id,
      version: policy.version,
      club: policy.applicability.club,
      title: policy.title,
      sourceType: stored.sourceType,
      storedKind: "DEMO",
      declaredKind: doc.kind ?? null,
      rules: policy.rules.length,
      fileName: input.fileName ?? null,
      sha256,
    },
  });
  const pkg = fromStored(stored, now);
  if (!pkg) throw new AppError("INTERNAL", "Stored policy package failed validation");
  return { package: pkg.summary, notes, stored: true };
}

/** Sets the workspace default package of `club` (a preset or an uploaded package of that club). */
export async function selectWorkspaceDefault(input: { club: string; packageId: string; selectedBy: string }): Promise<PolicySelectionRecord> {
  if (!ClubSchema.safeParse(input.club).success) throw new AppError("BAD_REQUEST", `Unknown club "${input.club}"`);
  const pkg = (await resolvePackage(input.packageId))?.summary;
  if (!pkg) throw new AppError("NOT_FOUND", `Policy package "${input.packageId}" not found`);
  if (pkg.club !== input.club) throw new AppError("BAD_REQUEST", `"${pkg.title}" is a ${pkg.club} package, not ${input.club}`);
  const record = await required(() =>
    policyPackages.setSelection({ club: input.club, packageId: pkg.id, packageVersion: pkg.version, selectedBy: input.selectedBy }),
  );
  await events.append({
    subjectType: "policy_selection",
    subjectId: input.club,
    type: "POLICY_SELECTED",
    actor: input.selectedBy,
    payload: { club: input.club, packageId: pkg.id, version: pkg.version, sourceType: pkg.sourceType, kind: pkg.kind },
  });
  return record;
}
