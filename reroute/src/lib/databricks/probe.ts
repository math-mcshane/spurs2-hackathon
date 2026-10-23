/**
 * Read-only Databricks Jobs API probes (no run-now).
 */
import { complianceJobConfigured } from "./jobs";

export type DatabricksProbeResult = {
  ok: boolean;
  configured: boolean;
  jobId?: number;
  hostConfigured: boolean;
  tokenConfigured: boolean;
  latestRun?: {
    runId: number;
    state: string;
    lifeCycleState?: string;
    resultState?: string;
    startTime?: number;
  };
  error?: string;
};

function hostFromEnv(): string | undefined {
  const raw =
    process.env.DATABRICKS_HOST?.trim() ||
    process.env.DATABRICKS_URL?.trim() ||
    process.env.DATBARICKS_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

function tokenFromEnv(): string | undefined {
  return process.env.DATABRICKS_TOKEN?.trim() || process.env.DATABRICKS_API_KEY?.trim() || undefined;
}

function jobIdFromEnv(): number | undefined {
  const raw = process.env.DATABRICKS_COMPLIANCE_JOB_ID?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Lightweight check: env present + optional latest run for the compliance job. */
export async function probeDatabricksJob(): Promise<DatabricksProbeResult> {
  const host = hostFromEnv();
  const token = tokenFromEnv();
  const jobId = jobIdFromEnv();
  const configured = complianceJobConfigured();

  if (!host || !token || !jobId) {
    return {
      ok: false,
      configured: false,
      hostConfigured: Boolean(host),
      tokenConfigured: Boolean(token),
      jobId,
      error: "DATABRICKS_HOST/URL, DATABRICKS_TOKEN/API_KEY, or DATABRICKS_COMPLIANCE_JOB_ID unset",
    };
  }

  try {
    const url = `${host}/api/2.1/jobs/runs/list?job_id=${jobId}&limit=1&expand_tasks=false`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const text = await resp.text();
    let body: {
      runs?: Array<{
        run_id?: number;
        state?: { life_cycle_state?: string; result_state?: string; state_message?: string };
        start_time?: number;
      }>;
      message?: string;
      error_code?: string;
    } = {};
    try {
      body = text ? (JSON.parse(text) as typeof body) : {};
    } catch {
      body = { message: text.slice(0, 300) };
    }

    if (!resp.ok) {
      return {
        ok: false,
        configured,
        jobId,
        hostConfigured: true,
        tokenConfigured: true,
        error: body.message || body.error_code || `HTTP ${resp.status}`,
      };
    }

    const run = body.runs?.[0];
    const life = run?.state?.life_cycle_state;
    const result = run?.state?.result_state;
    const state = [life, result].filter(Boolean).join("/") || "unknown";

    return {
      ok: true,
      configured,
      jobId,
      hostConfigured: true,
      tokenConfigured: true,
      latestRun: run?.run_id
        ? {
            runId: run.run_id,
            state,
            lifeCycleState: life,
            resultState: result,
            startTime: run.start_time,
          }
        : undefined,
    };
  } catch (err) {
    return {
      ok: false,
      configured,
      jobId,
      hostConfigured: true,
      tokenConfigured: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
