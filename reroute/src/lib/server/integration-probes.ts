/**
 * Public integration probes — read-only, no secrets in responses.
 * Maps to CDM bridge: ScorePlay → webhooks → Supabase → Databricks → eligible/evidence → Studio.
 */
import { ScorePlayHttpClient } from "@/lib/scoreplay/client";
import { TwelveLabsVideoIntelligence } from "@/lib/twelvelabs/client";
import { probeDatabricksJob, type DatabricksProbeResult } from "@/lib/databricks/probe";
import { complianceJobConfigured } from "@/lib/databricks/jobs";
import { getSupabaseAdmin, supabaseConfigured } from "@/lib/supabase/admin";
import { discoverPartners } from "@/lib/discover/service";
export type ProbeStatus = "ok" | "degraded" | "error" | "not_configured";

export type ProbeResult = {
  integration: string;
  status: ProbeStatus;
  latencyMs: number;
  detail: Record<string, unknown>;
};

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; latencyMs: number }> {
  const t0 = Date.now();
  const value = await fn();
  return { value, latencyMs: Date.now() - t0 };
}

async function tableCount(table: string): Promise<{ count: number | null; error?: string }> {
  const { count, error } = await getSupabaseAdmin()
    .from(table)
    .select("*", { count: "exact", head: true });
  if (error) return { count: null, error: error.message };
  return { count: count ?? 0 };
}

export function envSnapshot(): Record<string, boolean> {
  return {
    SCOREPLAY_API_KEY: Boolean(process.env.SCOREPLAY_API_KEY?.trim()),
    SCOREPLAY_WEBHOOK_SECRET: Boolean(process.env.SCOREPLAY_WEBHOOK_SECRET?.trim()),
    SUPABASE_URL: Boolean(
      process.env.SUPABASE_URL?.trim() || process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
    ),
    SUPABASE_SECRET_KEY: Boolean(
      process.env.SUPABASE_SECRET_KEY?.trim() || process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
    ),
    DATABRICKS_HOST: Boolean(
      process.env.DATABRICKS_HOST?.trim() ||
        process.env.DATABRICKS_URL?.trim() ||
        process.env.DATBARICKS_URL?.trim(),
    ),
    DATABRICKS_TOKEN: Boolean(
      process.env.DATABRICKS_TOKEN?.trim() || process.env.DATABRICKS_API_KEY?.trim(),
    ),
    DATABRICKS_COMPLIANCE_JOB_ID: Boolean(process.env.DATABRICKS_COMPLIANCE_JOB_ID?.trim()),
    DATABRICKS_WAREHOUSE_ID: Boolean(process.env.DATABRICKS_WAREHOUSE_ID?.trim()),
    TWELVELABS_API_KEY: Boolean(process.env.TWELVELABS_API_KEY?.trim()),
    TWELVELABS_INDEX_ID: Boolean(process.env.TWELVELABS_INDEX_ID?.trim()),
    REROUTE_TEST_SECRET: Boolean(process.env.REROUTE_TEST_SECRET?.trim()),
    MEDIA_PROCESSING_APPROVED: process.env.MEDIA_PROCESSING_APPROVED === "true",
    SCOREPLAY_UPLOAD_APPROVED: process.env.SCOREPLAY_UPLOAD_APPROVED === "true",
  };
}

export async function probeScorePlay(): Promise<ProbeResult> {
  if (!process.env.SCOREPLAY_API_KEY?.trim()) {
    return {
      integration: "scoreplay",
      status: "not_configured",
      latencyMs: 0,
      detail: { missing: ["SCOREPLAY_API_KEY"] },
    };
  }
  try {
    const { value, latencyMs } = await timed(() => new ScorePlayHttpClient().whoami());
    return {
      integration: "scoreplay",
      status: "ok",
      latencyMs,
      detail: {
        company: value.company?.name ?? null,
        subdomain: value.company?.subdomain ?? null,
        userType: value.user_type ?? null,
      },
    };
  } catch (err) {
    return {
      integration: "scoreplay",
      status: "error",
      latencyMs: 0,
      detail: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

export async function probeTwelveLabs(): Promise<ProbeResult> {
  if (!process.env.TWELVELABS_API_KEY?.trim() || !process.env.TWELVELABS_INDEX_ID?.trim()) {
    return {
      integration: "twelvelabs",
      status: "not_configured",
      latencyMs: 0,
      detail: {
        missing: [
          !process.env.TWELVELABS_API_KEY?.trim() && "TWELVELABS_API_KEY",
          !process.env.TWELVELABS_INDEX_ID?.trim() && "TWELVELABS_INDEX_ID",
        ].filter(Boolean),
      },
    };
  }
  try {
    const { value, latencyMs } = await timed(() => new TwelveLabsVideoIntelligence().describeIndex());
    return {
      integration: "twelvelabs",
      status: "ok",
      latencyMs,
      detail: {
        indexId: value.index.id,
        name: value.index.name ?? null,
        videoCount: value.index.videoCount ?? null,
        models: value.index.models,
        origin: value.origin,
      },
    };
  } catch (err) {
    return {
      integration: "twelvelabs",
      status: "error",
      latencyMs: 0,
      detail: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

export async function probeSupabase(): Promise<ProbeResult> {
  if (!supabaseConfigured()) {
    return {
      integration: "supabase",
      status: "not_configured",
      latencyMs: 0,
      detail: { missing: ["SUPABASE_URL", "SUPABASE_SECRET_KEY"] },
    };
  }

  const tables = [
    "scoreplay_webhook_events",
    "scoreplay_inbound_media",
    "evidence",
    "observation_runs",
    "partners",
    "partnership_agreements",
    "eligible_media",
    "receipts",
    "compliance_rejected",
    "l1_decisions",
    "compliance_summary",
    "l2_requests",
    "l2_decisions",
    "media_passports",
  ] as const;

  try {
    const { value, latencyMs } = await timed(async () => {
      const counts: Record<string, number | null> = {};
      const errors: Record<string, string> = {};
      await Promise.all(
        tables.map(async (t) => {
          const r = await tableCount(t);
          counts[t] = r.count;
          if (r.error) errors[t] = r.error;
        }),
      );
      return { counts, errors };
    });

    const missingTables = Object.keys(value.errors);
    const status: ProbeStatus =
      missingTables.length === 0
        ? "ok"
        : missingTables.length < tables.length
          ? "degraded"
          : "error";

    return {
      integration: "supabase",
      status,
      latencyMs,
      detail: {
        counts: value.counts,
        ...(missingTables.length ? { tableErrors: value.errors } : {}),
        cdmMirror: {
          inbound: value.counts.scoreplay_inbound_media,
          eligible: value.counts.eligible_media,
          evidence: value.counts.evidence,
          partners: value.counts.partners,
          agreements: value.counts.partnership_agreements,
        },
      },
    };
  } catch (err) {
    return {
      integration: "supabase",
      status: "error",
      latencyMs: 0,
      detail: { error: err instanceof Error ? err.message : String(err) },
    };
  }
}

export async function probeDatabricks(): Promise<ProbeResult> {
  if (!complianceJobConfigured()) {
    return {
      integration: "databricks",
      status: "not_configured",
      latencyMs: 0,
      detail: {
        missing: [
          "DATABRICKS_HOST or DATABRICKS_URL",
          "DATABRICKS_TOKEN or DATABRICKS_API_KEY",
          "DATABRICKS_COMPLIANCE_JOB_ID",
        ],
      },
    };
  }
  const { value, latencyMs } = await timed(() => probeDatabricksJob());
  const db: DatabricksProbeResult = value;
  const latestOk =
    !db.latestRun ||
    db.latestRun.resultState === "SUCCESS" ||
    db.latestRun.lifeCycleState === "RUNNING" ||
    db.latestRun.lifeCycleState === "PENDING";

  return {
    integration: "databricks",
    status: db.ok && latestOk ? "ok" : db.ok ? "degraded" : "error",
    latencyMs,
    detail: {
      jobId: db.jobId,
      latestRun: db.latestRun ?? null,
      ...(db.error ? { error: db.error } : {}),
      pipelineTasks: [
        "ensure_ddl",
        "sync_supabase_webhooks",
        "bronze_webhooks",
        "silver_assets",
        "l1_preprocess",
        "enrich_eligible",
        "sync_eligible_supabase",
        "l2_contextual",
      ],
    },
  };
}

/** End-to-end CDM mirror health: inbound → eligible → evidence → discover. */
export async function probeCdm(): Promise<ProbeResult> {
  const t0 = Date.now();
  const supabase = await probeSupabase();
  const databricks = await probeDatabricks();

  let discoverSample: Record<string, unknown> | null = null;
  let discoverStatus: ProbeStatus = "not_configured";
  if (supabaseConfigured()) {
    try {
      const result = await discoverPartners({ q: "Nike", clubCode: "SAS", limit: 3 });
      discoverSample = {
        source: result.source,
        intent: result.intent,
        hitCount: result.hits.length,
        top: result.hits.slice(0, 2).map((h) => ({
          mediaId: h.asset.id,
          title: h.asset.title,
          fit: h.fit,
          brands: h.brandsSeen,
        })),
      };
      discoverStatus = result.hits.length > 0 ? "ok" : "degraded";
    } catch (err) {
      discoverStatus = "error";
      discoverSample = { error: err instanceof Error ? err.message : String(err) };
    }
  }

  const counts = (supabase.detail.counts ?? {}) as Record<string, number | null>;
  const inbound = counts.scoreplay_inbound_media ?? 0;
  const eligible = counts.eligible_media ?? 0;
  const evidence = counts.evidence ?? 0;
  const partners = counts.partners ?? 0;

  const gaps: string[] = [];
  if (supabase.status === "not_configured") gaps.push("supabase_not_configured");
  if (databricks.status === "not_configured") gaps.push("databricks_job_trigger_not_configured");
  if (partners === 0) gaps.push("no_partners_seed — paste 20261022230100_seed_demo_partners.sql");
  if (inbound > 0 && eligible === 0) {
    gaps.push("inbound_without_eligible — run policy_engine sync_eligible_supabase");
  }
  if (eligible > 0 && evidence === 0) {
    gaps.push("eligible_without_evidence — enrich_eligible + sync may not have written evidence");
  }
  if (discoverStatus === "degraded") gaps.push("discover_empty_for_Nike_SAS");

  const statuses = [supabase.status, databricks.status, discoverStatus];
  let status: ProbeStatus = "ok";
  if (statuses.includes("error")) status = "error";
  else if (statuses.includes("not_configured") || statuses.includes("degraded") || gaps.length) {
    status = "degraded";
  }

  return {
    integration: "cdm",
    status,
    latencyMs: Date.now() - t0,
    detail: {
      funnel: {
        webhook_events: counts.scoreplay_webhook_events,
        inbound_media: inbound,
        eligible_media: eligible,
        evidence_rows: evidence,
        partners,
        partnership_agreements: counts.partnership_agreements,
      },
      databricks: {
        status: databricks.status,
        jobId: databricks.detail.jobId,
        latestRun: databricks.detail.latestRun,
      },
      discover: { status: discoverStatus, sample: discoverSample },
      gaps,
      appApisAligned: [
        { cdm: "scoreplay_inbound_media", api: "GET /api/webhooks/scoreplay/inbound" },
        { cdm: "scoreplay_webhook_events", api: "GET /api/webhooks/scoreplay/events" },
        { cdm: "observation_runs", api: "GET /api/observations/runs" },
        { cdm: "eligible_media (UC sync)", api: "GET /api/eligible + GET /api/discover" },
        { cdm: "partners + agreements", api: "GET /api/partners" },
        { cdm: "evidence (TL + HUMAN)", api: "GET /api/evidence · POST /api/observations" },
        { cdm: "media_passports (L2)", api: "GET /api/passport?mediaId=" },
        { cdm: "compliance mirrors", api: "GET /api/compliance/* · PATCH /api/rejected/[mediaId]" },
        { cdm: "l2_requests staging", api: "POST /api/decide (lake badge) · POST /api/l2/enqueue" },
        { cdm: "receipts / reviews SoR", api: "POST/GET /api/receipts*" },
        { cdm: "UC gold (warehouse)", api: "GET /api/lake/compliance" },
        { cdm: "policy_activations", api: "GET /api/policies → lakeActivations" },
        { cdm: "pipeline job", api: "GET /api/test/databricks (read) · webhook triggers run-now" },
      ],
      appApisMissing: [
        "UC rules.* packs still parallel to git JSON (/api/policies) — optional pack export",
      ],
    },
  };
}

export async function runAllProbes(): Promise<{
  at: string;
  env: Record<string, boolean>;
  probes: ProbeResult[];
  overall: ProbeStatus;
}> {
  const probes = await Promise.all([
    probeScorePlay(),
    probeTwelveLabs(),
    probeSupabase(),
    probeDatabricks(),
    probeCdm(),
  ]);
  let overall: ProbeStatus = "ok";
  for (const p of probes) {
    if (p.status === "error") {
      overall = "error";
      break;
    }
    if (p.status === "not_configured" || p.status === "degraded") overall = "degraded";
  }
  return { at: new Date().toISOString(), env: envSnapshot(), probes, overall };
}
