/**
 * Browser-side client for the REROUTE HTTP API. Every response is parsed with the shared
 * contract schemas; every non-2xx response is surfaced as an `ApiClientError` carrying the
 * uniform `ApiError` code so the UI can render precise inline states (e.g. NOT_CONFIGURED).
 */
import { z } from "zod";
import {
  AccessResponseSchema,
  ApiErrorSchema,
  AssetSchema,
  AssetsResponseSchema,
  DiscoverResponseSchema,
  DecideResponseSchema,
  EvidenceSchema,
  MediaRefSchema,
  PassportResponseSchema,
  RenderResponseSchema,
  RightsReceiptSchema,
  WritebackResponseSchema,
  type AccessActionSchema,
  type RecoverRequestSchema,
  type ApiError,
  type ClubCode,
  type EditPlan,
  type Evidence,
  type PublishIntent,
} from "@/lib/contracts";
import { PolicyContextSchema, RecoveryViewSchema } from "@/features/pulse/types";

export class ApiClientError extends Error {
  constructor(
    readonly code: ApiError["code"] | "NETWORK" | "BAD_RESPONSE",
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** GET /api/policies — no global "active" policy: decisions select one per asset + publish intent. */
export const PolicySummarySchema = z.object({
  id: z.string(),
  version: z.string(),
  title: z.string(),
  kind: z.enum(["VERIFIED", "DEMO"]),
  /** = kind === "DEMO". */
  fictional: z.boolean(),
  club: z.string(),
  competitions: z.array(z.string()),
  provenance: z.string().optional(),
  validFrom: z.string(),
  validUntil: z.string(),
  source: z.string(),
  disclaimer: z.string(),
});
export type PolicySummary = z.infer<typeof PolicySummarySchema>;
export const PoliciesResponseSchema = z.object({
  policies: z.array(PolicySummarySchema),
  /** Unity Catalog policy-pack activations mirrored into Supabase (best-effort; absent/empty when unavailable). */
  lakeActivations: z
    .array(
      z.object({
        layer: z.string(),
        packId: z.string(),
        version: z.string(),
        clubCode: z.string().optional(),
        activatedAt: z.string().optional(),
      }),
    )
    .optional(),
});
export type PoliciesResponse = z.infer<typeof PoliciesResponseSchema>;

/** GET /api/assets/[id]?club= */
export const AssetDetailResponseSchema = z.object({
  asset: AssetSchema,
  observations: z.array(EvidenceSchema),
  /** UNLINKABLE = the ScorePlay ↔ TwelveLabs identity is not proven, so no analysis is attached. */
  analysis: z.enum(["AVAILABLE", "NOT_CONFIGURED", "FAILED", "UNLINKABLE"]),
  analysisDetail: z.string().optional(),
  media: MediaRefSchema.optional(),
  notes: z.array(z.string()).default([]),
});
export type AssetDetailResponse = z.infer<typeof AssetDetailResponseSchema>;

/** Every receipt-returning route adds the human-review audit trail to `RightsReceipt`. */
export const ReceiptViewSchema = RightsReceiptSchema.extend({
  reviews: z
    .array(z.object({ status: z.enum(["APPROVED", "REJECTED"]), reviewer: z.string(), at: z.string() }))
    .default([]),
});
export type ReceiptView = z.infer<typeof ReceiptViewSchema>;
const WritebackViewSchema = WritebackResponseSchema.extend({ receipt: ReceiptViewSchema });
const RenderViewSchema = RenderResponseSchema.extend({ receipt: ReceiptViewSchema });

const ObservationResponseSchema = z.object({ evidence: EvidenceSchema });

/** POST /api/recover: the recovery plan (read-only, nothing stored) and the rule package it used. */
export const RecoverResponseSchema = z.object({
  recovery: RecoveryViewSchema,
  media: z.array(MediaRefSchema),
  notes: z.array(z.string()),
  policy: PolicyContextSchema.nullable(),
});
export type RecoverResponse = z.infer<typeof RecoverResponseSchema>;

async function request<S extends z.ZodType>(
  schema: S,
  path: string,
  init?: { method?: "GET" | "POST"; body?: unknown; signal?: AbortSignal },
): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: init?.method ?? "GET",
      headers: init?.body === undefined ? undefined : { "content-type": "application/json" },
      body: init?.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init?.signal,
      cache: "no-store",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiClientError("NETWORK", `Network error calling ${path}`, 0);
  }

  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const parsed = ApiErrorSchema.safeParse(json);
    if (parsed.success) throw new ApiClientError(parsed.data.code, parsed.data.error, res.status);
    throw new ApiClientError("BAD_RESPONSE", `${path} failed with HTTP ${res.status}`, res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) {
    throw new ApiClientError("BAD_RESPONSE", `${path} returned a response that violates the contract`, res.status);
  }
  return parsed.data;
}

type Sig = { signal?: AbortSignal };

export const api = {
  policies: (o?: Sig) => request(PoliciesResponseSchema, "/api/policies", o),
  searchAssets: (q: string, o?: Sig) =>
    request(AssetsResponseSchema, `/api/assets?${new URLSearchParams({ q, limit: "12" })}`, o),
  discover: (q: string, club?: ClubCode, o?: Sig) => {
    const params = new URLSearchParams({ q, limit: "12" });
    if (club) params.set("club", club);
    return request(DiscoverResponseSchema, `/api/discover?${params}`, o);
  },

  asset: (id: string, o?: Sig) => request(AssetDetailResponseSchema, `/api/assets/${encodeURIComponent(id)}`, o),
  passport: (mediaId: string, o?: Sig) =>
    request(PassportResponseSchema, `/api/passport?${new URLSearchParams({ mediaId })}`, o),
  enqueueL2: (mediaId: string, force = true) =>
    request(
      z.object({
        ok: z.boolean(),
        skipped: z.boolean().optional(),
        reason: z.string().optional(),
        runId: z.number().optional(),
        jobId: z.number().optional(),
        note: z.string().optional(),
      }),
      "/api/l2/enqueue",
      { method: "POST", body: { mediaId, force } },
    ),
  addObservation: (evidence: Omit<Evidence, "source" | "origin">) =>
    request(ObservationResponseSchema, "/api/observations", {
      method: "POST",
      body: { ...evidence, source: "HUMAN" },
    }),
  decide: (body: { edit: EditPlan; intent: PublishIntent }, o?: Sig) =>
    request(DecideResponseSchema, "/api/decide", { method: "POST", body, ...o }),
  recover: (body: z.input<typeof RecoverRequestSchema>, o?: Sig) =>
    request(RecoverResponseSchema, "/api/recover", { method: "POST", body, ...o }),
  access: (body: { edit: EditPlan; intent: PublishIntent; action: z.infer<typeof AccessActionSchema> }, o?: Sig) =>
    request(AccessResponseSchema, "/api/access", { method: "POST", body, ...o }),
  createReceipt: (body: { edit: EditPlan; intent: PublishIntent }) =>
    request(ReceiptViewSchema, "/api/receipts", { method: "POST", body }),
  receipt: (id: string) => request(ReceiptViewSchema, `/api/receipts/${encodeURIComponent(id)}`),
  review: (id: string, body: { status: "APPROVED" | "REJECTED"; reviewer: string }) =>
    request(ReceiptViewSchema, `/api/receipts/${encodeURIComponent(id)}/review`, { method: "POST", body }),
  writeback: (receiptId: string) =>
    request(WritebackViewSchema, "/api/writeback", { method: "POST", body: { receiptId } }),
  render: (body: { edit: EditPlan; intent: PublishIntent }) =>
    request(RenderViewSchema, "/api/render", { method: "POST", body }),
};

export function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

/** Human-readable message for an API failure, naming the unconfigured integration when known. */
export function describeError(err: unknown): { title: string; detail: string; code: string } {
  if (err instanceof ApiClientError) {
    const titles: Record<ApiClientError["code"], string> = {
      NOT_CONFIGURED: "Not configured",
      FORBIDDEN: "Forbidden by gate",
      BAD_REQUEST: "Invalid request",
      NOT_FOUND: "Not found",
      UPSTREAM: "Upstream service error",
      CONFLICT: "Changed elsewhere",
      RATE_LIMITED: "Too many requests",
      INTERNAL: "Server error",
      NETWORK: "Network error",
      BAD_RESPONSE: "Unexpected response",
    };
    return { title: titles[err.code], detail: err.message, code: err.code };
  }
  return { title: "Error", detail: err instanceof Error ? err.message : String(err), code: "UNKNOWN" };
}
