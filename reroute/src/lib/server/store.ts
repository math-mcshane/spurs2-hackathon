import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  EvidenceSchema,
  RightsReceiptSchema,
  type Decision,
  type EditPlan,
  type Evidence,
  type HumanReviewStatus,
  type PublishIntent,
  type RightsReceipt,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { z } from "zod";

/**
 * Tiny local JSON store (`.data/store.json`, gitignored): receipts, review log, HUMAN observations.
 * Writes are serialized in-process and atomic on disk (temp file + rename). No DB by design.
 */

const ReviewRecordSchema = z.object({
  status: z.enum(["APPROVED", "REJECTED"]),
  reviewer: z.string(),
  at: z.iso.datetime({ offset: true }),
});
export type ReviewRecord = z.infer<typeof ReviewRecordSchema>;

const StoreDataSchema = z.object({
  receipts: z.record(z.string(), RightsReceiptSchema).default({}),
  reviews: z.record(z.string(), z.array(ReviewRecordSchema)).default({}),
  observations: z.record(z.string(), z.array(EvidenceSchema)).default({}),
});
type StoreData = z.infer<typeof StoreDataSchema>;

/** Receipt as returned by the API: the contract shape plus the review audit trail. */
export type StoredReceipt = RightsReceipt & { reviews: ReviewRecord[] };

const DATA_DIR = path.join(process.cwd(), ".data");
const STORE_FILE = path.join(DATA_DIR, "store.json");

let queue: Promise<unknown> = Promise.resolve();

async function load(): Promise<StoreData> {
  let raw: string;
  try {
    raw = await readFile(STORE_FILE, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return StoreDataSchema.parse({});
    throw err;
  }
  const parsed = StoreDataSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new AppError("INTERNAL", `Corrupt local store ${STORE_FILE}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

async function save(data: StoreData): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${STORE_FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, STORE_FILE);
}

/** Run `fn` exclusively against the store; persists only if `fn` returns `{ write: true }`. */
function transact<T>(fn: (data: StoreData) => { result: T; write: boolean }): Promise<T> {
  const run = queue.then(async () => {
    const data = await load();
    const { result, write } = fn(data);
    if (write) await save(data);
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

function withReviews(data: StoreData, receipt: RightsReceipt): StoredReceipt {
  return { ...receipt, reviews: data.reviews[receipt.id] ?? [] };
}

// ---------- Receipts ----------

/** `id` may be preallocated (render writes `.renders/<id>.mp4` before the receipt exists). */
export function createReceipt(input: {
  id?: string;
  edit: EditPlan;
  intent: PublishIntent;
  decision: Decision;
}): Promise<StoredReceipt> {
  const receipt: RightsReceipt = {
    id: input.id ?? randomUUID(),
    sourceAssetIds: [...new Set(input.edit.segments.map((s) => s.scoreplayMediaId))],
    intent: input.intent,
    decision: input.decision,
    edit: input.edit,
    humanReviewStatus: "PENDING",
    createdAt: new Date().toISOString(),
    writeback: [],
  };
  return transact((data) => {
    data.receipts[receipt.id] = receipt;
    return { result: withReviews(data, receipt), write: true };
  });
}

export function getReceipt(id: string): Promise<StoredReceipt> {
  return transact((data) => {
    const receipt = data.receipts[id];
    if (!receipt) throw new AppError("NOT_FOUND", `Receipt ${id} not found`);
    return { result: withReviews(data, receipt), write: false };
  });
}

/** Apply a mutation to one receipt; the result is re-validated against the contract before saving. */
export function updateReceipt(id: string, mutate: (r: RightsReceipt) => RightsReceipt): Promise<StoredReceipt> {
  return transact((data) => {
    const current = data.receipts[id];
    if (!current) throw new AppError("NOT_FOUND", `Receipt ${id} not found`);
    const next = RightsReceiptSchema.parse(mutate(structuredClone(current)));
    data.receipts[id] = next;
    return { result: withReviews(data, next), write: true };
  });
}

/** Record a human review decision (status + reviewer + time) on a receipt. */
export function recordReview(
  id: string,
  review: { status: Exclude<HumanReviewStatus, "PENDING">; reviewer: string },
  guard: (r: RightsReceipt) => void,
): Promise<StoredReceipt> {
  return transact((data) => {
    const current = data.receipts[id];
    if (!current) throw new AppError("NOT_FOUND", `Receipt ${id} not found`);
    guard(current);
    const record: ReviewRecord = { ...review, at: new Date().toISOString() };
    const next: RightsReceipt = { ...current, humanReviewStatus: review.status };
    data.receipts[id] = next;
    data.reviews[id] = [...(data.reviews[id] ?? []), record];
    return { result: withReviews(data, next), write: true };
  });
}

// ---------- HUMAN observations ----------

export function addHumanObservation(evidence: Evidence): Promise<Evidence> {
  const stored: Evidence = { ...evidence, source: "HUMAN", origin: "HUMAN" };
  return transact((data) => {
    const list = data.observations[stored.scoreplayMediaId] ?? [];
    data.observations[stored.scoreplayMediaId] = [...list, stored];
    return { result: stored, write: true };
  });
}

export function listHumanObservations(scoreplayMediaId: string): Promise<Evidence[]> {
  return transact((data) => ({ result: data.observations[scoreplayMediaId] ?? [], write: false }));
}
