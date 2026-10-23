/**
 * Databricks SQL Statement Execution API (warehouse-backed UC reads).
 *
 * Env:
 *   DATABRICKS_HOST / DATABRICKS_URL
 *   DATABRICKS_TOKEN / DATABRICKS_API_KEY
 *   DATABRICKS_WAREHOUSE_ID
 */

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

function warehouseIdFromEnv(): string | undefined {
  return process.env.DATABRICKS_WAREHOUSE_ID?.trim() || undefined;
}

export function warehouseSqlConfigured(): boolean {
  return Boolean(hostFromEnv() && tokenFromEnv() && warehouseIdFromEnv());
}

export type SqlQueryResult = {
  columns: string[];
  rows: Record<string, unknown>[];
  statementId: string;
};

type StatementResponse = {
  statement_id?: string;
  status?: { state?: string; error?: { message?: string } };
  manifest?: {
    schema?: { columns?: { name: string }[] };
    total_chunk_count?: number;
  };
  result?: {
    data_array?: unknown[][];
  };
};

/**
 * Run a read-only SQL statement against the configured SQL warehouse.
 * Polls until SUCCEEDED / FAILED (max ~30s).
 */
export async function runWarehouseSql(
  sql: string,
  opts?: { catalog?: string; schema?: string; timeoutSec?: number },
): Promise<SqlQueryResult> {
  const host = hostFromEnv();
  const token = tokenFromEnv();
  const warehouseId = warehouseIdFromEnv();
  if (!host || !token || !warehouseId) {
    throw new Error("DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID required");
  }

  const timeoutSec = opts?.timeoutSec ?? 30;
  const startResp = await fetch(`${host}/api/2.0/sql/statements`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      warehouse_id: warehouseId,
      statement: sql,
      wait_timeout: `${Math.min(timeoutSec, 50)}s`,
      on_wait_timeout: "CONTINUE",
      catalog: opts?.catalog ?? "spurs2",
      schema: opts?.schema ?? "gold",
    }),
    signal: AbortSignal.timeout((timeoutSec + 5) * 1000),
  });

  const startText = await startResp.text();
  let body: StatementResponse = {};
  try {
    body = startText ? (JSON.parse(startText) as StatementResponse) : {};
  } catch {
    throw new Error(`SQL start bad JSON: ${startText.slice(0, 200)}`);
  }
  if (!startResp.ok) {
    throw new Error(body.status?.error?.message || startText.slice(0, 300) || startResp.statusText);
  }

  let statementId = body.statement_id;
  if (!statementId) throw new Error("SQL statement missing statement_id");

  const deadline = Date.now() + timeoutSec * 1000;
  while (true) {
    const state = body.status?.state ?? "PENDING";
    if (state === "SUCCEEDED") break;
    if (state === "FAILED" || state === "CANCELED" || state === "CLOSED") {
      throw new Error(body.status?.error?.message || `SQL statement ${state}`);
    }
    if (Date.now() > deadline) throw new Error("SQL statement timed out");

    await new Promise((r) => setTimeout(r, 800));
    const poll = await fetch(`${host}/api/2.0/sql/statements/${statementId}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
    const pollText = await poll.text();
    try {
      body = pollText ? (JSON.parse(pollText) as StatementResponse) : {};
    } catch {
      throw new Error(`SQL poll bad JSON: ${pollText.slice(0, 200)}`);
    }
    statementId = body.statement_id ?? statementId;
  }

  const columns = (body.manifest?.schema?.columns ?? []).map((c) => c.name);
  const data = body.result?.data_array ?? [];
  const rows = data.map((arr) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((name, i) => {
      obj[name] = arr[i] ?? null;
    });
    return obj;
  });

  return { columns, rows, statementId };
}
