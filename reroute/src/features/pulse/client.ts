/** Browser client for /api/pulse/*; same error semantics as REROUTE's api-client (ApiClientError codes). */
import { z } from "zod";
import { ApiErrorSchema } from "@/lib/contracts";
import { ApiClientError } from "@/lib/api-client";
import {
  BusinessMetricsSchema,
  CampaignViewSchema,
  GoalViewSchema,
  HandoffResponseSchema,
  OpportunitiesResponseSchema,
  OpportunityResponseSchema,
  OpportunityViewSchema,
  type ActionRequest,
  type GoalAction,
  type ManualTrigger,
} from "./types";

async function call<S extends z.ZodType>(schema: S, path: string, body?: unknown): Promise<z.infer<S>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError("NETWORK", `Network error calling ${path}`, 0);
  }
  const json: unknown = await res.json().catch(() => undefined);
  if (!res.ok) {
    const err = ApiErrorSchema.safeParse(json);
    if (err.success) throw new ApiClientError(err.data.code, err.data.error, res.status);
    throw new ApiClientError(res.status === 404 ? "NOT_FOUND" : "BAD_RESPONSE", `${path} failed with HTTP ${res.status}`, res.status);
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new ApiClientError("BAD_RESPONSE", `${path} returned a response that violates the contract`, res.status);
  return parsed.data;
}

const GoalResponseSchema = z.object({ goal: GoalViewSchema.nullable() });
const GoalActionResponseSchema = z.object({ goal: GoalViewSchema });

export const pulseApi = {
  list: () => call(OpportunitiesResponseSchema, "/api/pulse/opportunities"),
  get: (id: string) => call(OpportunityResponseSchema, `/api/pulse/opportunities?${new URLSearchParams({ id })}`),
  refresh: (body: { manual?: ManualTrigger; objective?: string | null } = {}) =>
    call(OpportunitiesResponseSchema, "/api/pulse/refresh", body),
  handoff: (opportunityId: string, scoreplayAssetId: string) =>
    call(HandoffResponseSchema, "/api/pulse/handoff", { opportunityId, scoreplayAssetId }),
  act: (body: Exclude<ActionRequest, { action: "draftCampaign" }>) =>
    call(z.object({ opportunity: OpportunityViewSchema }), "/api/pulse/opportunities", body),
  draftCampaign: (body: Extract<ActionRequest, { action: "draftCampaign" }>) =>
    call(z.object({ opportunity: OpportunityViewSchema, campaign: CampaignViewSchema }), "/api/pulse/opportunities", body),
  business: () => call(BusinessMetricsSchema, "/api/pulse/business"),
  goal: (id?: string) => call(GoalResponseSchema, `/api/pulse/goal${id ? `?${new URLSearchParams({ id })}` : ""}`).then((r) => r.goal),
  goalAction: (body: GoalAction) => call(GoalActionResponseSchema, "/api/pulse/goal", body).then((r) => r.goal),
};
