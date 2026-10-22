import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  BlockerSchema,
  DecisionSchema,
  EvidenceSchema,
  HumanReviewStatusSchema,
  MediaRefSchema,
  PublishIntentSchema,
  RightsReceiptSchema,
  type RightsReceipt,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import type { GoalRun } from "@/features/pulse/types";
import { assertGoalRunId, assertUuid, casUpdate, goalRunColumns, parseEvaluation } from "./shared";
import type {
  AlternativeRecord,
  AuditEvent,
  CampaignRecord,
  EvaluationRecord,
  Repositories,
  ReviewRecord,
  WritebackAttempt,
} from "./types";

/**
 * Supabase adapter (schema: supabase/migrations/*). Uses the privileged server client; every table is
 * RLS-protected with no anon/authenticated grants, so nothing here is reachable from the browser.
 */

function fail(op: string, error: PostgrestError): never {
  // 42P01 / PGRST205 / PGRST202: table or function missing → migrations not applied.
  const missing = error.code === "42P01" || error.code === "PGRST205" || error.code === "PGRST202";
  if (missing) {
    throw new AppError("NOT_CONFIGURED", `Supabase schema missing (${op}): apply supabase/migrations (supabase db push / db reset)`);
  }
  // 23505 unique / 23503 foreign key / 23514 check / 22P02 bad uuid: the caller sent something invalid.
  if (error.code === "23505" || error.code === "23503" || error.code === "23514" || error.code === "22P02") {
    throw new AppError("BAD_REQUEST", `Supabase ${op} rejected: ${error.message}`);
  }
  throw new AppError("UPSTREAM", `Supabase ${op} failed: ${error.message}`);
}

const iso = (v: string) => new Date(v).toISOString();
const opt = <T>(v: T | null): T | undefined => (v === null ? undefined : v);

const CampaignRowSchema = z.object({
  id: z.string(),
  goal_run_id: z.string().nullable(),
  opportunity_id: z.string().nullable(),
  current_version: z.number().int(),
  status: z.string(),
  review_status: HumanReviewStatusSchema.nullable(),
  receipt_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const CAMPAIGN_COLUMNS = "id, goal_run_id, opportunity_id, current_version, status, review_status, receipt_id, created_at, updated_at";

const EventRowSchema = z.object({
  id: z.coerce.number().int(),
  subject_type: z.string(),
  subject_id: z.string(),
  type: z.string(),
  actor: z.string(),
  payload: z.unknown(),
  prev_hash: z.string().nullable(),
  hash: z.string(),
  created_at: z.string(),
});

const EvaluationRowSchema = z.object({
  id: z.string(),
  campaign_id: z.string().nullable(),
  campaign_version: z.number().int().nullable(),
  receipt_id: z.string().nullable(),
  kind: z.enum(["ORIGINAL", "ALTERNATIVE"]),
  scoreplay_media_ids: z.array(z.string()),
  media: z.array(MediaRefSchema),
  intent: PublishIntentSchema,
  decision: DecisionSchema,
  policy_kind: z.enum(["VERIFIED", "DEMO"]).nullable(),
  created_at: z.string(),
});

const AlternativeRowSchema = z.object({
  id: z.string(),
  evaluation_id: z.string(),
  blocker: BlockerSchema,
  candidates: z.array(z.unknown()),
  created_at: z.string(),
});

const WritebackRowSchema = z.object({
  id: z.string(),
  receipt_id: z.string(),
  mode: z.enum(["DRY_RUN", "LIVE"]),
  status: z.enum(["DRY_RUN", "REFUSED", "WRITTEN", "VERIFIED", "FAILED"]),
  planned: z.array(z.unknown()),
  detail: z.string().nullable(),
  actor: z.string(),
  created_at: z.string(),
});

const ReviewRowSchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]), reviewer: z.string(), at: z.string() });

function toEvent(row: unknown): AuditEvent {
  const r = EventRowSchema.parse(row);
  return {
    id: r.id,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    type: r.type,
    actor: r.actor,
    payload: r.payload,
    prevHash: r.prev_hash,
    hash: r.hash,
    at: iso(r.created_at),
  };
}

function toEvaluation(row: unknown): EvaluationRecord {
  const r = EvaluationRowSchema.parse(row);
  return {
    id: r.id,
    campaignId: opt(r.campaign_id),
    campaignVersion: opt(r.campaign_version),
    receiptId: opt(r.receipt_id),
    kind: r.kind,
    scoreplayMediaIds: r.scoreplay_media_ids,
    media: r.media,
    intent: r.intent,
    decision: r.decision,
    policyKind: opt(r.policy_kind),
    createdAt: iso(r.created_at),
  };
}

function toAlternative(row: unknown): AlternativeRecord {
  const r = AlternativeRowSchema.parse(row);
  return { id: r.id, evaluationId: r.evaluation_id, blocker: r.blocker, candidates: r.candidates, createdAt: iso(r.created_at) };
}

function toWriteback(row: unknown): WritebackAttempt {
  const r = WritebackRowSchema.parse(row);
  return {
    id: r.id,
    receiptId: r.receipt_id,
    mode: r.mode,
    status: r.status,
    planned: r.planned,
    detail: opt(r.detail),
    actor: r.actor,
    createdAt: iso(r.created_at),
  };
}

function receiptRow(receipt: RightsReceipt) {
  return {
    receipt,
    verdict: receipt.decision.verdict,
    human_review_status: receipt.humanReviewStatus,
    source_asset_ids: receipt.sourceAssetIds,
    campaign_id: receipt.campaignId ?? null,
    media: receipt.media,
  };
}

/** `db` is resolved per call so a missing env surfaces as NOT_CONFIGURED on use, not at import. */
export function supabaseRepositories(db: () => SupabaseClient): Repositories {
  async function loadGoalRun(id: string): Promise<{ value: GoalRun; version: number }> {
    const { data, error } = await db().from("reroute_goal_runs").select("document, version").eq("id", id).maybeSingle();
    if (error) fail("read goal run", error);
    if (!data) throw new AppError("NOT_FOUND", `Goal ${id} not found`);
    return { value: data.document as GoalRun, version: data.version as number };
  }

  async function campaignRecord(row: unknown): Promise<CampaignRecord> {
    const r = CampaignRowSchema.parse(row);
    const { data, error } = await db()
      .from("reroute_campaign_versions")
      .select("draft")
      .eq("campaign_id", r.id)
      .eq("version", r.current_version)
      .single();
    if (error) fail("read campaign draft", error);
    return {
      id: r.id,
      goalRunId: opt(r.goal_run_id),
      opportunityId: opt(r.opportunity_id),
      currentVersion: r.current_version,
      status: r.status,
      reviewStatus: opt(r.review_status),
      receiptId: opt(r.receipt_id),
      draft: data.draft as unknown,
      createdAt: iso(r.created_at),
      updatedAt: iso(r.updated_at),
    };
  }

  return {
    goalRuns: {
      async create(run) {
        const id = assertGoalRunId(run);
        const { error } = await db().from("reroute_goal_runs").insert({ id, document: run, ...goalRunColumns(run) });
        if (error) fail("create goal run", error);
        return run;
      },
      get: async (id) => (await loadGoalRun(id)).value,
      async getVersioned(id) {
        const { value, version } = await loadGoalRun(id);
        return { run: value, version };
      },
      async latest() {
        const { data, error } = await db()
          .from("reroute_goal_runs")
          .select("document")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) fail("read latest goal run", error);
        return data ? (data.document as GoalRun) : null;
      },
      async update(id, mutate, expectedVersion) {
        const { value } = await casUpdate(
          `Goal ${id}`,
          () => loadGoalRun(id),
          async (next, version) => {
            if (assertGoalRunId(next) !== id) throw new AppError("BAD_REQUEST", "A goal run's id cannot change");
            const { data, error } = await db()
              .from("reroute_goal_runs")
              .update({ document: next, ...goalRunColumns(next), version: version + 1, updated_at: new Date().toISOString() })
              .eq("id", id)
              .eq("version", version)
              .select("id");
            if (error) fail("update goal run", error);
            return data.length === 1;
          },
          mutate,
          expectedVersion,
        );
        return value;
      },
    },

    campaigns: {
      async saveVersion(campaignId, draft, actor, link) {
        assertUuid(campaignId, "campaignId");
        const { data, error } = await db().rpc("reroute_save_campaign_version", {
          p_campaign_id: campaignId,
          p_draft: draft,
          p_actor: actor,
          p_goal_run_id: link?.goalRunId ?? null,
          p_opportunity_id: link?.opportunityId ?? null,
        });
        if (error) fail("save campaign version", error);
        return z.number().int().parse(data);
      },
      async get(campaignId) {
        assertUuid(campaignId, "campaignId");
        const { data, error } = await db().from("reroute_campaigns").select(CAMPAIGN_COLUMNS).eq("id", campaignId).maybeSingle();
        if (error) fail("read campaign", error);
        if (!data) throw new AppError("NOT_FOUND", `Campaign ${campaignId} not found`);
        return campaignRecord(data);
      },
      async findByGoalRun(goalRunId) {
        const { data, error } = await db()
          .from("reroute_campaigns")
          .select(CAMPAIGN_COLUMNS)
          .eq("goal_run_id", goalRunId)
          .order("created_at", { ascending: true });
        if (error) fail("list campaigns", error);
        return Promise.all(data.map(campaignRecord));
      },
      async findByOpportunity(opportunityId) {
        const { data, error } = await db()
          .from("reroute_campaigns")
          .select(CAMPAIGN_COLUMNS)
          .eq("opportunity_id", opportunityId)
          .maybeSingle();
        if (error) fail("read campaign", error);
        return data ? campaignRecord(data) : null;
      },
      async listVersions(campaignId) {
        assertUuid(campaignId, "campaignId");
        const { data, error } = await db()
          .from("reroute_campaign_versions")
          .select("version, draft, actor, created_at")
          .eq("campaign_id", campaignId)
          .order("version", { ascending: true });
        if (error) fail("list campaign versions", error);
        return data.map((r) => ({ version: r.version as number, draft: r.draft as unknown, actor: r.actor as string, createdAt: iso(r.created_at) }));
      },
      async setState(campaignId, state) {
        assertUuid(campaignId, "campaignId");
        const patch = {
          ...(state.status !== undefined && { status: state.status }),
          ...(state.reviewStatus !== undefined && { review_status: state.reviewStatus }),
          ...(state.receiptId !== undefined && { receipt_id: state.receiptId }),
          updated_at: new Date().toISOString(),
        };
        const { data, error } = await db().from("reroute_campaigns").update(patch).eq("id", campaignId).select("id");
        if (error) fail("update campaign", error);
        if (data.length === 0) throw new AppError("NOT_FOUND", `Campaign ${campaignId} not found`);
      },
    },

    evaluations: {
      async record(raw) {
        const { input, policyKind } = parseEvaluation(raw);
        const { data, error } = await db()
          .from("reroute_evaluations")
          .insert({
            campaign_id: input.campaignId ?? null,
            campaign_version: input.campaignVersion ?? null,
            receipt_id: input.receiptId ?? null,
            kind: input.kind,
            scoreplay_media_ids: input.scoreplayMediaIds,
            media: input.media,
            intent: input.intent,
            decision: input.decision,
            verdict: input.decision.verdict,
            clearance: input.decision.clearance,
            policy_id: input.decision.policyId,
            policy_kind: policyKind ?? null,
          })
          .select("*")
          .single();
        if (error) fail("record evaluation", error);
        return toEvaluation(data);
      },
      async listForCampaign(campaignId) {
        assertUuid(campaignId, "campaignId");
        const { data, error } = await db()
          .from("reroute_evaluations")
          .select("*")
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: true });
        if (error) fail("list evaluations", error);
        return data.map(toEvaluation);
      },
    },

    alternatives: {
      async record(input) {
        assertUuid(input.evaluationId, "evaluationId");
        const { data, error } = await db()
          .from("reroute_alternatives")
          .insert({ evaluation_id: input.evaluationId, blocker: BlockerSchema.parse(input.blocker), candidates: input.candidates })
          .select("*")
          .single();
        if (error) fail("record alternatives", error);
        return toAlternative(data);
      },
      async listForEvaluation(evaluationId) {
        assertUuid(evaluationId, "evaluationId");
        const { data, error } = await db()
          .from("reroute_alternatives")
          .select("*")
          .eq("evaluation_id", evaluationId)
          .order("created_at", { ascending: true });
        if (error) fail("list alternatives", error);
        return data.map(toAlternative);
      },
    },

    events: {
      async append(input) {
        // id, prev_hash, hash and created_at are assigned by the reroute_events_chain trigger.
        const { data, error } = await db()
          .from("reroute_events")
          .insert({
            subject_type: input.subjectType,
            subject_id: input.subjectId,
            type: input.type,
            actor: input.actor,
            payload: input.payload ?? {},
          })
          .select("*")
          .single();
        if (error) fail("append event", error);
        return toEvent(data);
      },
      async list(subjectType, subjectId) {
        const { data, error } = await db()
          .from("reroute_events")
          .select("*")
          .eq("subject_type", subjectType)
          .eq("subject_id", subjectId)
          .order("id", { ascending: true });
        if (error) fail("list events", error);
        return data.map(toEvent);
      },
      async verifyChain() {
        const { data, error } = await db().rpc("reroute_verify_events");
        if (error) fail("verify event chain", error);
        return data === null ? null : Number(data);
      },
    },

    writebackAttempts: {
      async record(input) {
        const { data, error } = await db()
          .from("reroute_writeback_attempts")
          .insert({
            receipt_id: input.receiptId,
            mode: input.mode,
            status: input.status,
            planned: input.planned,
            detail: input.detail ?? null,
            actor: input.actor,
          })
          .select("*")
          .single();
        if (error) fail("record writeback attempt", error);
        return toWriteback(data);
      },
      async listForReceipt(receiptId) {
        const { data, error } = await db()
          .from("reroute_writeback_attempts")
          .select("*")
          .eq("receipt_id", receiptId)
          .order("created_at", { ascending: true });
        if (error) fail("list writeback attempts", error);
        return data.map(toWriteback);
      },
    },

    observationCache: {
      async get(twelvelabsVideoId, modelKey) {
        const { data, error } = await db()
          .from("reroute_observation_cache")
          .select("evidence")
          .eq("twelvelabs_video_id", twelvelabsVideoId)
          .eq("model_key", modelKey)
          .maybeSingle();
        if (error) fail("read observation cache", error);
        return data ? (data.evidence as unknown) : undefined;
      },
      async put(twelvelabsVideoId, modelKey, value) {
        const { error } = await db()
          .from("reroute_observation_cache")
          .upsert({ twelvelabs_video_id: twelvelabsVideoId, model_key: modelKey, evidence: value, created_at: new Date().toISOString() });
        if (error) fail("write observation cache", error);
      },
    },

    receipts: {
      async insert(receipt) {
        const { error } = await db().from("reroute_receipts").insert({ id: receipt.id, ...receiptRow(receipt) });
        if (error) fail("create receipt", error);
      },
      async load(id) {
        const { data, error } = await db().from("reroute_receipts").select("receipt, version").eq("id", id).maybeSingle();
        if (error) fail("read receipt", error);
        if (!data) throw new AppError("NOT_FOUND", `Receipt ${id} not found`);
        return { receipt: RightsReceiptSchema.parse(data.receipt), version: data.version as number };
      },
      async compareAndSet(id, version, next) {
        const { data, error } = await db()
          .from("reroute_receipts")
          .update({ ...receiptRow(next), version: version + 1, updated_at: new Date().toISOString() })
          .eq("id", id)
          .eq("version", version)
          .select("id");
        if (error) fail("update receipt", error);
        return data.length === 1;
      },
      async latestForCampaign(campaignId) {
        assertUuid(campaignId, "campaignId");
        const { data, error } = await db()
          .from("reroute_receipts")
          .select("receipt")
          .eq("campaign_id", campaignId)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) fail("read campaign receipt", error);
        return data ? RightsReceiptSchema.parse(data.receipt) : null;
      },
      async findForEdit(editId, policyVersion) {
        const { data, error } = await db()
          .from("reroute_receipts")
          .select("receipt")
          .eq("receipt->edit->>id", editId)
          .eq("receipt->decision->>policyVersion", policyVersion)
          .order("created_at", { ascending: false })
          .limit(50);
        if (error) fail("find receipts for edit", error);
        return data.map((r) => RightsReceiptSchema.parse(r.receipt));
      },
      async addReview(receiptId, review: ReviewRecord) {
        const { error } = await db()
          .from("reroute_reviews")
          .insert({ receipt_id: receiptId, status: review.status, reviewer: review.reviewer, at: review.at });
        if (error) fail("record review", error);
      },
      async listReviews(receiptId) {
        const { data, error } = await db()
          .from("reroute_reviews")
          .select("status, reviewer, at")
          .eq("receipt_id", receiptId)
          .order("at", { ascending: true });
        if (error) fail("read reviews", error);
        return data.map((r) => {
          const row = ReviewRowSchema.parse(r);
          return { ...row, at: iso(row.at) };
        });
      },
    },

    humanObservations: {
      async add(evidence) {
        const { error } = await db()
          .from("reroute_observations")
          .insert({ scoreplay_media_id: evidence.scoreplayMediaId, evidence });
        if (error) fail("add observation", error);
      },
      async list(scoreplayMediaId) {
        const { data, error } = await db()
          .from("reroute_observations")
          .select("evidence")
          .eq("scoreplay_media_id", scoreplayMediaId)
          .order("created_at", { ascending: true });
        if (error) fail("list observations", error);
        return data.map((r) => EvidenceSchema.parse(r.evidence));
      },
    },
  };
}
