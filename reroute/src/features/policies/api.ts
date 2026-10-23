import { z } from "zod";
import { ApiErrorSchema } from "@/lib/contracts";
import { ApiClientError } from "@/lib/api-client";
import { CLUBS } from "@/features/pulse/clubs";

/** Browser client for `/api/policies/**` (shapes mirror `lib/rights/packages.ts`). */

export const PackageSummarySchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  club: z.string(),
  kind: z.enum(["VERIFIED", "DEMO"]),
  sourceType: z.enum(["PRESET", "UPLOADED_JSON", "UPLOADED_CSV", "SAMPLE_DOCUMENT_MAPPING"]),
  verified: z.boolean(),
  fictional: z.boolean(),
  label: z.string(),
  territories: z.array(z.string()),
  territoriesByUsage: z.record(z.string(), z.array(z.string())).optional(),
  platforms: z.array(z.string()),
  usages: z.array(z.string()),
  partners: z.array(z.string()),
  validFrom: z.string(),
  validUntil: z.string(),
  uploadedBy: z.string().optional(),
  uploadedAt: z.string().optional(),
  fileName: z.string().optional(),
  sha256: z.string().optional(),
  warnings: z.array(z.string()),
  competitions: z.array(z.string()),
  provenance: z.string().optional(),
  source: z.string(),
  disclaimer: z.string(),
  isDefault: z.boolean(),
});
export type PackageSummary = z.infer<typeof PackageSummarySchema>;

const LibrarySchema = z.object({
  policies: z.array(PackageSummarySchema),
  defaults: z.record(z.string(), z.string()),
  uploadsAvailable: z.boolean(),
});
export type Library = z.infer<typeof LibrarySchema>;

const PlainRuleSchema = z.object({
  id: z.string(),
  effect: z.enum(["PERMIT", "DENY"]),
  topics: z.array(z.string()),
  text: z.string(),
  conditions: z.array(z.string()),
  term: z.string().optional(),
});
export type PlainRule = z.infer<typeof PlainRuleSchema>;

const DetailSchema = z.object({ policy: PackageSummarySchema, rules: z.array(PlainRuleSchema) });
export type PackageDetail = z.infer<typeof DetailSchema>;

const UploadSchema = z.object({ package: PackageSummarySchema.omit({ isDefault: true }), notes: z.array(z.string()) });
const SelectionSchema = z.object({
  selection: z.object({ club: z.string(), packageId: z.string(), packageVersion: z.string(), selectedBy: z.string(), selectedAt: z.string() }),
});

async function call<S extends z.ZodType>(schema: S, path: string, init?: RequestInit): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(path, { cache: "no-store", ...init });
  } catch {
    throw new ApiClientError("NETWORK", `Network error calling ${path}`, 0);
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(json);
    if (err.success) throw new ApiClientError(err.data.code, err.data.error, res.status);
    throw new ApiClientError("BAD_RESPONSE", `${path} failed with HTTP ${res.status}`, res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiClientError("BAD_RESPONSE", `${path} returned a response that violates the contract`, res.status);
  return parsed.data;
}

export const SAMPLE_HREF = "/api/policies/sample";

export const policiesApi = {
  library: (club?: string, signal?: AbortSignal) =>
    call(LibrarySchema, club ? `/api/policies?${new URLSearchParams({ club })}` : "/api/policies", { signal }),
  detail: (id: string, signal?: AbortSignal) => call(DetailSchema, `/api/policies/${encodeURIComponent(id)}`, { signal }),
  upload: (file: File) => {
    const form = new FormData();
    form.set("file", file);
    return call(UploadSchema, "/api/policies", { method: "POST", body: form });
  },
  select: (club: string, packageId: string) =>
    call(SelectionSchema, "/api/policies/select", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ club, packageId }),
    }),
};

/** "Fictional demo policy" / "Uploaded — unverified" / "Verified agreement". */
export function authenticity(p: Pick<PackageSummary, "sourceType" | "verified">): string {
  if (p.sourceType !== "PRESET") return "Uploaded — unverified";
  return p.verified ? "Verified agreement" : "Fictional demo policy";
}

export const clubLabel = (club: string) => (CLUBS as Record<string, { label: string } | undefined>)[club]?.label ?? club;
