import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { STATE_ROOT } from "@/lib/state-dir";
import {
  DetectedOpportunitySchema,
  LedgerEntrySchema,
  MediaLookupSchema,
  ParsedObjectiveSchema,
  SnapshotMetaSchema,
  StoredManualTriggerSchema,
} from "../types";

/**
 * State of the fan-signal BOARD only (`/pulse/board`, behind PULSE_BOARD_ENABLED, SIMULATED signals):
 * snapshot, ledger, manual triggers, board objective — in `.data/pulse.json` (gitignored; ephemeral `/tmp`
 * on Vercel). Nothing durable lives here: goal runs, campaigns, evaluations, receipts and audit events are
 * in Supabase (`lib/server/repositories`). Serialized in-process, atomic on disk.
 */

const SnapshotSchema = z.object({
  meta: SnapshotMetaSchema,
  opportunities: z.array(DetectedOpportunitySchema),
  media: z.record(z.string(), MediaLookupSchema),
});
export type Snapshot = z.infer<typeof SnapshotSchema>;

const PulseDataSchema = z.object({
  /** Derived data: a snapshot written by an older PULSE version is dropped and rebuilt on the next read. */
  snapshot: SnapshotSchema.optional().catch(undefined),
  manualTriggers: z.array(StoredManualTriggerSchema).default([]),
  ledger: z.record(z.string(), LedgerEntrySchema).default({}),
  /** The board's active business objective, if the producer set one. An objective saved by an older PULSE version is dropped. */
  objective: ParsedObjectiveSchema.optional().catch(undefined),
});
export type PulseData = z.infer<typeof PulseDataSchema>;

const DATA_DIR = path.join(STATE_ROOT, ".data");
const FILE = path.join(DATA_DIR, "pulse.json");

let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<PulseData> {
  let raw: string;
  try {
    raw = await readFile(FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return PulseDataSchema.parse({});
    throw err;
  }
  const parsed = PulseDataSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) throw new AppError("INTERNAL", `Corrupt PULSE store ${FILE}: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

async function save(data: PulseData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(PulseDataSchema.parse(data), null, 2), "utf8");
  await rename(tmp, FILE);
}

/** Run `fn` exclusively against the board store; persists only if `fn` returns `{ write: true }`. */
export function transact<T>(fn: (data: PulseData) => { result: T; write: boolean }): Promise<T> {
  const run = queue.then(async () => {
    const data = await load();
    const { result, write } = fn(data);
    if (write) await save(data);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

export function readPulse(): Promise<PulseData> {
  return transact((data) => ({ result: data, write: false }));
}
