/**
 * Trigger Databricks Jobs (Jobs API 2.1) for per-artifact compliance.
 *
 * Env (Vercel / .env.local):
 *   DATABRICKS_HOST or DATABRICKS_URL — workspace URL
 *   DATABRICKS_TOKEN or DATABRICKS_API_KEY — PAT
 *   DATABRICKS_COMPLIANCE_JOB_ID — e.g. 933748301369007
 */

export type ComplianceJobTriggerInput = {
  mediaId: string;
  /** Re-evaluate even if gold.l1_decisions already has a row (media.update). */
  force?: boolean;
  runMode?: "incremental" | "full";
  lookbackHours?: number;
};

export type ComplianceJobTriggerResult =
  | { ok: true; skipped: true; reason: string }
  | { ok: true; skipped: false; runId: number; jobId: number }
  | { ok: false; error: string };

function hostFromEnv(): string | undefined {
  const raw =
    process.env.DATABRICKS_HOST?.trim() ||
    process.env.DATABRICKS_URL?.trim() ||
    // common typo in local andres/.env
    process.env.DATBARICKS_URL?.trim();
  if (!raw) return undefined;
  return raw.replace(/\/+$/, "");
}

function tokenFromEnv(): string | undefined {
  return (
    process.env.DATABRICKS_TOKEN?.trim() ||
    process.env.DATABRICKS_API_KEY?.trim() ||
    undefined
  );
}

function jobIdFromEnv(): number | undefined {
  const raw = process.env.DATABRICKS_COMPLIANCE_JOB_ID?.trim();
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function complianceJobConfigured(): boolean {
  return Boolean(hostFromEnv() && tokenFromEnv() && jobIdFromEnv());
}

/**
 * Fire `jobs/run-now` for the compliance pipeline, scoped to one media_id.
 * Never throws — callers embed the result in webhook responses.
 */
export async function triggerComplianceJob(
  input: ComplianceJobTriggerInput,
): Promise<ComplianceJobTriggerResult> {
  const host = hostFromEnv();
  const token = tokenFromEnv();
  const jobId = jobIdFromEnv();

  if (!host || !token || !jobId) {
    return {
      ok: true,
      skipped: true,
      reason:
        "DATABRICKS_HOST/URL, DATABRICKS_TOKEN/API_KEY, or DATABRICKS_COMPLIANCE_JOB_ID unset",
    };
  }

  const mediaId = input.mediaId.trim();
  if (!mediaId) {
    return { ok: true, skipped: true, reason: "media_id missing" };
  }

  const force = input.force === true;
  const runMode = input.runMode ?? "incremental";
  const lookbackHours = input.lookbackHours ?? 24;

  const url = `${host}/api/2.1/jobs/run-now`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        job_id: jobId,
        job_parameters: {
          catalog: "spurs2",
          run_mode: runMode,
          force: force ? "true" : "false",
          media_id: mediaId,
          lookback_hours: String(lookbackHours),
        },
      }),
      signal: AbortSignal.timeout(15_000),
    });

    const text = await resp.text();
    let body: { run_id?: number; message?: string; error_code?: string } = {};
    try {
      body = text ? (JSON.parse(text) as typeof body) : {};
    } catch {
      body = { message: text.slice(0, 300) };
    }

    if (!resp.ok) {
      const detail =
        body.message || body.error_code || text.slice(0, 300) || resp.statusText;
      console.error("[databricks jobs/run-now]", resp.status, detail);
      return { ok: false, error: `HTTP ${resp.status}: ${detail}` };
    }

    if (typeof body.run_id !== "number") {
      return { ok: false, error: "jobs/run-now response missing run_id" };
    }

    return { ok: true, skipped: false, runId: body.run_id, jobId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[databricks jobs/run-now]", msg);
    return { ok: false, error: msg };
  }
}
