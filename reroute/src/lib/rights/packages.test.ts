import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { canPublish, type Asset, type EditPlan, type Evidence, type PublishIntent } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { memoryRepositories } from "@/lib/server/repositories/memory";
import { resetRepositoriesForTests, useMemoryRepositoriesForTests, useRepositoriesForTests } from "@/lib/server/repositories/testing";
import type { Repositories } from "@/lib/server/repositories/types";
import { evaluateEdit, type AnalysisStatus } from "./engine";
import {
  PRESET_LABEL,
  UPLOAD_LABEL,
  UPLOADS_NOT_CONFIGURED,
  defaultPackageFor,
  describeRule,
  getPolicyPackage,
  policiesForEvaluation,
  policyLibrary,
  selectWorkspaceDefault,
  uploadPolicyPackage,
} from "./packages";
import { PolicySchema, type Policy } from "./policy";
import sample from "./policies/tottenham-international-window.sample.json";
import { BUNDLED_POLICIES, PRESET_POLICIES, SAMPLE_UPLOAD_POLICY } from "./registry";

const now = new Date("2026-10-22T12:00:00Z");
const ANALYSED: AnalysisStatus = { status: "AVAILABLE" };

const SQUAD = { "Dominic Solanke-Mitchell": ["Tottenham Hotspur FC"], "Micky van de Ven": ["Tottenham Hotspur FC"] };
const goalClip: Asset = {
  id: "goal",
  title: "Clip goal",
  kind: "video",
  durationSec: 20,
  tags: ["partner content", "Premier League", "Tottenham Hotspur", "Manchester United", "Match"],
  facts: {
    competition: "Premier League",
    teams: ["Tottenham Hotspur", "Manchester United"],
    people: ["Dominic Solanke-Mitchell", "Micky van de Ven"],
    peopleTeams: SQUAD,
  },
  metadata: {},
  origin: "LIVE",
};

const ev = (label: string, extra: Partial<Evidence> = {}): Evidence => ({
  scoreplayMediaId: "goal",
  start: 2,
  end: 6,
  observation: `${label.split(":").pop()}: seen`,
  source: "TWELVELABS",
  label,
  confidence: 0.9,
  origin: "LIVE",
  ...extra,
});
const groupShot: Evidence = { scoreplayMediaId: "goal", observation: "Rubric player_focus: group", source: "TWELVELABS", label: "rubric:player_focus:group", origin: "LIVE" };
/** Kraken on the shirt sleeve, a squad player, nothing else branded. */
const KRAKEN = [groupShot, ev("brand:kraken"), ev("person:solanke")];

const intent = (over: Partial<PublishIntent>): PublishIntent => ({
  territory: "GB",
  platform: "instagram",
  usage: "EDITORIAL",
  competition: "Premier League",
  club: "tottenham",
  publishAt: "2026-11-01T18:00:00Z",
  ...over,
});

function decide(policies: readonly Policy[], publish: PublishIntent, observations: Evidence[] = KRAKEN) {
  const edit: EditPlan = { id: "e-goal", title: "t", derived: false, segments: [{ scoreplayMediaId: "goal", start: 0, end: 10 }] };
  return evaluateEdit({ edit, assets: { goal: goalClip }, observations: { goal: observations }, analysis: { goal: ANALYSED }, intent: publish, now, policies }).decision;
}

const upload = (doc: unknown, uploadedBy = "Ed Smith") => uploadPolicyPackage({ text: JSON.stringify(doc), fileName: "rules.json", uploadedBy }, now);

let repos: Repositories;
beforeEach(() => {
  repos = useMemoryRepositoriesForTests();
});
afterEach(() => resetRepositoriesForTests());

describe("presets", () => {
  it("are fictional demo packages; the default evaluation set keeps one package per club", () => {
    for (const p of [...PRESET_POLICIES, SAMPLE_UPLOAD_POLICY]) {
      expect(p.kind).toBe("DEMO");
      expect(p.disclaimer).toContain("FICTIONAL DEMO POLICY");
    }
    expect(PRESET_POLICIES.map((p) => p.id)).toEqual(["demo-spurs-fr-sponsored", "demo-tottenham-pl", "demo-tottenham-commercial"]);
    expect(BUNDLED_POLICIES.map((p) => p.id)).toEqual(["demo-spurs-fr-sponsored", "demo-tottenham-pl"]);
    expect(PRESET_POLICIES.map((p) => p.title)).toEqual([
      "Spurs Media Usage — Demo",
      "Tottenham Social Media Usage — Demo",
      "Tottenham Commercial & Sponsor Usage — Demo",
    ]);
  });

  it("the upload sample is a valid DEMO package that is not in the library until uploaded", async () => {
    expect(PolicySchema.parse(sample).id).toBe("demo-tottenham-international");
    expect(await getPolicyPackage("demo-tottenham-international")).toBeNull();
  });

  it("summaries derive licensed uses, partners and term from the rules", async () => {
    const { packages, defaults, uploadsAvailable } = await policyLibrary(now);
    expect(uploadsAvailable).toBe(true);
    expect(defaults).toEqual({ spurs: "demo-spurs-fr-sponsored", tottenham: "demo-tottenham-pl" });
    const social = packages.find((p) => p.id === "demo-tottenham-pl")!;
    expect(social).toMatchObject({
      title: "Tottenham Social Media Usage — Demo",
      kind: "DEMO",
      sourceType: "PRESET",
      verified: false,
      fictional: true,
      label: PRESET_LABEL,
      territories: ["GB", "IE", "US", "CA", "AU", "NZ"],
      platforms: ["instagram", "facebook", "x", "tiktok", "youtube"],
      usages: ["EDITORIAL", "ORGANIC", "SPONSORED", "COMMERCIAL"],
      partners: ["AIA", "Nike"],
      validUntil: "2027-06-30T23:59:59Z",
      warnings: [],
    });
    const commercial = packages.find((p) => p.id === "demo-tottenham-commercial")!;
    expect(commercial.partners).toEqual(["AIA", "Nike", "Kraken"]);
    expect(commercial.territories).toEqual(["GB", "IE", "US", "CA", "AU", "NZ"]);
    expect(social.territoriesByUsage).toBeUndefined();
    expect(commercial.territoriesByUsage).toEqual({
      EDITORIAL: ["GB", "IE", "US", "CA", "AU", "NZ"],
      ORGANIC: ["GB", "IE", "US", "CA", "AU", "NZ"],
      SPONSORED: ["GB", "IE", "US"],
      COMMERCIAL: ["GB", "IE"],
    });
    expect(packages.find((p) => p.id === "demo-spurs-fr-sponsored")).toMatchObject({ territories: ["FR", "US"], platforms: ["instagram", "youtube"] });
  });

  it("warns about missing territory/expiry rules and a term ending within 30 days", async () => {
    const thin = {
      ...sample,
      id: "demo-thin",
      applicability: { ...sample.applicability, validUntil: "2026-11-10T00:00:00Z" },
      rules: sample.rules.filter((r) => !r.dimensions.includes("territory") && !r.dimensions.includes("expiry")),
    };
    const { package: pkg } = await upload(thin);
    expect(pkg.warnings).toEqual([
      "Uploaded by Ed Smith — these rules are unverified and only usable as a demo.",
      "No territory rule — no market is licensed, so every use will need review.",
      "No expiry rule — the licence term can't be confirmed, so every use will need review.",
      "Expires on 10 Nov 2026 — within 30 days.",
    ]);
  });

  it("rules read in plain language", () => {
    const rule = PRESET_POLICIES[2].rules.find((r) => r.id === "THFC-C16-partner-exclusivity")!;
    expect(describeRule(rule)).toEqual({
      id: "THFC-C16-partner-exclusivity",
      effect: "DENY",
      topics: ["Brands on screen"],
      text: rule.explanation,
      conditions: ["Seen on screen: any brand", "Except: Tottenham Hotspur, Spurs, THFC, AIA, Nike, Kraken", "Uses: sponsored, sales"],
      term: undefined,
    });
  });
});

describe("upload", () => {
  it("rejects invalid JSON, non-objects and documents that do not match the policy format", async () => {
    await expect(uploadPolicyPackage({ text: "{nope", uploadedBy: "ed" })).rejects.toMatchObject({ code: "BAD_REQUEST", message: "The file is not valid JSON" });
    await expect(uploadPolicyPackage({ text: "[1]", uploadedBy: "ed" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(upload({ ...sample, rules: [{ id: "x", effect: "MAYBE" }] })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: expect.stringMatching(/does not match the policy format/),
    });
    await expect(upload({ ...sample, applicability: { ...sample.applicability, club: "arsenal" } })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(uploadPolicyPackage({ text: " ".repeat(201 * 1024), uploadedBy: "ed" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(await repos.policyPackages.list()).toEqual([]);
  });

  it("an upload declaring kind VERIFIED is stored as DEMO, with a demo disclaimer, sha256 and an audit event", async () => {
    const verified = { ...sample, id: "claims-verified", kind: "VERIFIED", disclaimer: "Signed agreement" };
    const { package: pkg, notes } = await upload(verified);
    expect(pkg).toMatchObject({ id: "claims-verified", kind: "DEMO", verified: false, fictional: true, sourceType: "UPLOADED_JSON", label: UPLOAD_LABEL, uploadedBy: "Ed Smith" });
    expect(pkg.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(notes[0]).toMatch(/declared kind "VERIFIED"; it is stored as DEMO/);
    const stored = await repos.policyPackages.get("claims-verified");
    expect(stored).toMatchObject({ kind: "DEMO", document: { kind: "DEMO" } });
    expect(PolicySchema.parse(stored!.document).disclaimer).toContain("FICTIONAL DEMO POLICY");
    const [event] = await repos.events.list("policy_package", "claims-verified");
    expect(event).toMatchObject({ type: "POLICY_UPLOADED", actor: "Ed Smith", payload: { declaredKind: "VERIFIED", storedKind: "DEMO", sha256: pkg.sha256 } });
  });

  it("rejects preset ids, a duplicate version and an id owned by another club", async () => {
    await expect(upload({ ...sample, id: "demo-tottenham-pl" })).rejects.toMatchObject({ code: "CONFLICT" });
    await upload(sample);
    await expect(upload(sample)).rejects.toMatchObject({ code: "CONFLICT" });
    const spursDoc = PRESET_POLICIES[0];
    await expect(upload({ ...spursDoc, id: "demo-tottenham-international", version: "2" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("policiesForEvaluation", () => {
  const ids = (r: { policies: Policy[] }) => r.policies.map((p) => p.id);

  it("returns exactly one package per club: the requested one, else the club default", async () => {
    expect(ids(await policiesForEvaluation({ club: "tottenham" }))).toEqual(["demo-tottenham-pl", "demo-spurs-fr-sponsored"]);
    const commercial = await policiesForEvaluation({ club: "tottenham", packageId: "demo-tottenham-commercial" });
    expect(ids(commercial)).toEqual(["demo-tottenham-commercial", "demo-spurs-fr-sponsored"]);
    expect(commercial.package).toMatchObject({ id: "demo-tottenham-commercial", label: PRESET_LABEL });
    expect(ids(await policiesForEvaluation({ club: "spurs" }))).toEqual(["demo-spurs-fr-sponsored", "demo-tottenham-pl"]);
  });

  it("never applies another club's package; unknown ids fall back to the default", async () => {
    const wrongClub = await policiesForEvaluation({ club: "tottenham", packageId: "demo-spurs-fr-sponsored" });
    expect(ids(wrongClub)).toEqual(["demo-tottenham-pl", "demo-spurs-fr-sponsored"]);
    expect(wrongClub.package?.id).toBe("demo-tottenham-pl");
    expect(ids(await policiesForEvaluation({ club: "tottenham", packageId: "nope" }))).toEqual(["demo-tottenham-pl", "demo-spurs-fr-sponsored"]);
  });

  it("the workspace selection persists and becomes the default", async () => {
    await expect(selectWorkspaceDefault({ club: "tottenham", packageId: "demo-spurs-fr-sponsored", selectedBy: "Ed Smith" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const selection = await selectWorkspaceDefault({ club: "tottenham", packageId: "demo-tottenham-commercial", selectedBy: "Ed Smith" });
    expect(selection).toMatchObject({ club: "tottenham", packageId: "demo-tottenham-commercial", packageVersion: "2026-10-23.1", selectedBy: "Ed Smith" });
    expect(await repos.policyPackages.getSelection("tottenham")).toMatchObject({ packageId: "demo-tottenham-commercial" });
    expect((await defaultPackageFor("tottenham"))?.id).toBe("demo-tottenham-commercial");
    expect(ids(await policiesForEvaluation({ club: "tottenham" }))).toEqual(["demo-tottenham-commercial", "demo-spurs-fr-sponsored"]);
    expect((await policyLibrary(now)).defaults.tottenham).toBe("demo-tottenham-commercial");
    expect(await repos.events.list("policy_selection", "tottenham")).toMatchObject([{ type: "POLICY_SELECTED", actor: "Ed Smith" }]);
  });

  it("switching package changes the evaluation, traceably", async () => {
    const social = (await policiesForEvaluation({ club: "tottenham" })).policies;
    const commercial = (await policiesForEvaluation({ club: "tottenham", packageId: "demo-tottenham-commercial" })).policies;

    // Kraken sleeve in a sponsored GB post: not an official partner in the social package.
    const sponsoredGb = intent({ usage: "SPONSORED" });
    const a = decide(social, sponsoredGb);
    const b = decide(commercial, sponsoredGb);
    expect(a.verdict).toBe("BLOCKED");
    expect(a.reasons.find((r) => r.outcome === "DENY")?.ruleId).toBe("THFC-13-partner-exclusivity");
    expect(b.verdict).toBe("ALLOWED");
    expect(b.clearance).toBe("DEMO");
    expect(b.reasons.some((r) => r.ruleId === "THFC-C15-official-partners" && r.outcome === "PERMIT")).toBe(true);
    expect([a.policyId, a.policyVersion]).toEqual(["demo-tottenham-pl", "2026-10-23.1"]);
    expect(b.policyId).toBe("demo-tottenham-commercial");
    expect(b.policyId).not.toBe(a.policyId);

    // A sales post in the US: licensed by the social package, home market only in the commercial one.
    const salesUs = intent({ usage: "COMMERCIAL", territory: "US" });
    const plain = [groupShot, ev("brand:aia"), ev("person:solanke")];
    expect(decide(social, salesUs, plain).verdict).toBe("ALLOWED");
    const blocked = decide(commercial, salesUs, plain);
    expect(blocked.verdict).toBe("BLOCKED");
    expect(blocked.reasons.find((r) => r.outcome === "DENY")).toMatchObject({ ruleId: "THFC-C6-sales-home-market", dimension: "territory" });

    // A rival club crest is still a DENY under the commercial package.
    expect(decide(commercial, sponsoredGb, [groupShot, ev("brand:manchester-united"), ev("person:solanke")]).verdict).toBe("BLOCKED");
  });

  it("an ALLOWED decision under an uploaded package can never be published, even when approved", async () => {
    await upload({ ...sample, kind: "VERIFIED" });
    const run = await policiesForEvaluation({ club: "tottenham", packageId: "demo-tottenham-international" });
    expect(run.package).toMatchObject({ id: "demo-tottenham-international", sourceType: "UPLOADED_JSON", kind: "DEMO", verified: false });
    const editorialFr = intent({ territory: "FR" });
    const editorial = [groupShot, ev("person:solanke")];
    expect(decide((await policiesForEvaluation({ club: "tottenham" })).policies, editorialFr, editorial).verdict).toBe("NEEDS_REVIEW");
    const decision = decide(run.policies, editorialFr, editorial);
    expect(decision).toMatchObject({ verdict: "ALLOWED", clearance: "DEMO", policyFictional: true, policyId: "demo-tottenham-international" });
    expect(canPublish({ decision, humanReviewStatus: "APPROVED" })).toBe(false);
  });
});

describe("without the policy tables", () => {
  beforeEach(() => {
    const missing = () => Promise.reject(new AppError("NOT_CONFIGURED", "Supabase schema missing (list policy packages)"));
    const base = memoryRepositories();
    useRepositoriesForTests({
      ...base,
      policyPackages: { insert: missing, list: missing, get: missing, getSelection: missing, setSelection: missing },
    });
  });

  it("presets still list and evaluate; uploads and the workspace default say they are not set up", async () => {
    const library = await policyLibrary(now);
    expect(library.uploadsAvailable).toBe(false);
    expect(library.packages.map((p) => p.id)).toEqual(PRESET_POLICIES.map((p) => p.id));
    expect((await policiesForEvaluation({ club: "tottenham", packageId: "demo-tottenham-commercial" })).package?.id).toBe("demo-tottenham-commercial");
    await expect(upload(sample)).rejects.toMatchObject({ code: "NOT_CONFIGURED", message: UPLOADS_NOT_CONFIGURED });
    await expect(selectWorkspaceDefault({ club: "tottenham", packageId: "demo-tottenham-commercial", selectedBy: "ed" })).rejects.toMatchObject({
      code: "NOT_CONFIGURED",
      message: UPLOADS_NOT_CONFIGURED,
    });
  });
});
