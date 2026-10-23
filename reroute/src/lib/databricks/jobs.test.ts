import { afterEach, describe, expect, it, vi } from "vitest";
import { complianceJobConfigured, triggerComplianceJob } from "./jobs";

describe("databricks compliance job trigger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("skips when env unset", async () => {
    vi.stubEnv("DATABRICKS_HOST", "");
    vi.stubEnv("DATABRICKS_TOKEN", "");
    vi.stubEnv("DATABRICKS_COMPLIANCE_JOB_ID", "");
    expect(complianceJobConfigured()).toBe(false);
    const r = await triggerComplianceJob({ mediaId: "1" });
    expect(r).toMatchObject({ ok: true, skipped: true });
  });

  it("posts run-now with media_id and force", async () => {
    vi.stubEnv("DATABRICKS_URL", "https://adb.example.net/");
    vi.stubEnv("DATABRICKS_API_KEY", "dapi-test");
    vi.stubEnv("DATABRICKS_COMPLIANCE_JOB_ID", "933748301369007");

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ run_id: 42 }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const r = await triggerComplianceJob({ mediaId: "46000204", force: true });
    expect(r).toEqual({
      ok: true,
      skipped: false,
      runId: 42,
      jobId: 933748301369007,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://adb.example.net/api/2.1/jobs/run-now");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      Authorization: "Bearer dapi-test",
    });
    const body = JSON.parse(String(init.body)) as {
      job_id: number;
      job_parameters: Record<string, string>;
    };
    expect(body.job_id).toBe(933748301369007);
    expect(body.job_parameters).toMatchObject({
      media_id: "46000204",
      force: "true",
      run_mode: "incremental",
    });
  });
});
