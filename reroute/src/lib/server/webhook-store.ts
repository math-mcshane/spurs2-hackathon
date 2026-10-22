import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { z } from "zod";
import { STATE_ROOT } from "@/lib/state-dir";

/**
 * Append-only ScorePlay webhook log (`.data/webhooks.json`).
 * On Vercel this is under `/tmp` and ephemeral — fine for demo ack; forward to Databricks bronze later.
 */

export const StoredWebhookSchema = z.object({
  eventId: z.string(),
  event: z.enum(["media.create", "media.update"]),
  mediaId: z.string().optional(),
  companyId: z.string().optional(),
  receivedAt: z.string(),
  payload: z.unknown(),
  headers: z.record(z.string(), z.string()).optional(),
});
export type StoredWebhook = z.infer<typeof StoredWebhookSchema>;

const FileSchema = z.object({
  events: z.array(StoredWebhookSchema).default([]),
});

const DATA_DIR = path.join(STATE_ROOT, ".data");
const FILE = path.join(DATA_DIR, "webhooks.json");
const MAX_EVENTS = 500;

let queue: Promise<unknown> = Promise.resolve();

async function load() {
  try {
    const raw = await readFile(FILE, "utf8");
    return FileSchema.parse(JSON.parse(raw));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return FileSchema.parse({});
    throw err;
  }
}

async function save(data: z.infer<typeof FileSchema>) {
  await mkdir(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), "utf8");
  await rename(tmp, FILE);
}

export function appendWebhook(event: StoredWebhook): Promise<{ stored: StoredWebhook; duplicate: boolean }> {
  const run = queue.then(async () => {
    const data = await load();
    const existing = data.events.find((e) => e.eventId === event.eventId);
    if (existing) return { stored: existing, duplicate: true };
    data.events.push(event);
    if (data.events.length > MAX_EVENTS) data.events = data.events.slice(-MAX_EVENTS);
    await save(data);
    return { stored: event, duplicate: false };
  });
  queue = run.catch(() => undefined);
  return run;
}

export function listWebhooks(limit = 50): Promise<StoredWebhook[]> {
  const run = queue.then(async () => {
    const data = await load();
    return data.events.slice(-limit).reverse();
  });
  queue = run.catch(() => undefined);
  return run;
}
