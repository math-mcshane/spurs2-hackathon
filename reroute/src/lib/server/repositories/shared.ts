import { z } from "zod";
import { DecisionSchema, MediaRefSchema, PublishIntentSchema, type Decision } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import type { EvaluationInput } from "./types";

/** Optimistic read-modify-write attempts before giving up on a hot record. */
export const MAX_UPDATE_ATTEMPTS = 3;

const UUID = z.uuid();

export function assertUuid(id: string, what: string): void {
  if (!UUID.safeParse(id).success) throw new AppError("BAD_REQUEST", `${what} must be a uuid (got "${id}")`);
}

export function assertGoalRunId(run: { id?: unknown }): string {
  if (typeof run.id !== "string" || !run.id) throw new AppError("BAD_REQUEST", "Goal run needs a string id");
  return run.id;
}

/** Objective text and club columns of a goal run (the document itself stays opaque). */
export function goalRunColumns(run: { objective?: { raw?: unknown }; club?: unknown }): { objective: string; club: string } {
  const objective = typeof run.objective?.raw === "string" ? run.objective.raw : "";
  if (typeof run.club !== "string") throw new AppError("BAD_REQUEST", "Goal run needs a club");
  return { objective, club: run.club };
}

/**
 * Shared optimistic-concurrency loop. `load` returns the stored value + version; `write` persists `next`
 * only if the version is unchanged and reports whether it won.
 */
export async function casUpdate<T>(
  label: string,
  load: () => Promise<{ value: T; version: number }>,
  write: (next: T, version: number) => Promise<boolean>,
  mutate: (value: T) => void | T,
  expectedVersion?: number,
): Promise<{ value: T; version: number }> {
  const attempts = expectedVersion === undefined ? MAX_UPDATE_ATTEMPTS : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const current = await load();
    if (expectedVersion !== undefined && current.version !== expectedVersion) break;
    const draft = structuredClone(current.value);
    const next = mutate(draft) ?? draft;
    if (await write(next, current.version)) return { value: next, version: current.version + 1 };
  }
  throw new AppError(
    "CONFLICT",
    expectedVersion === undefined
      ? `${label} is being modified concurrently; retry`
      : `${label} changed since version ${expectedVersion}; reload and try again`,
  );
}

export type ParsedEvaluation = {
  input: Required<Pick<EvaluationInput, "kind" | "media" | "intent" | "decision" | "scoreplayMediaIds">> &
    Pick<EvaluationInput, "campaignId" | "campaignVersion" | "receiptId">;
  policyKind: "VERIFIED" | "DEMO" | undefined;
};

/** Validates an evaluation against the frozen contracts and derives its indexed columns. */
export function parseEvaluation(input: EvaluationInput): ParsedEvaluation {
  const media = z.array(MediaRefSchema).parse(input.media);
  const decision = DecisionSchema.parse(input.decision);
  const intent = PublishIntentSchema.parse(input.intent);
  if (input.campaignId !== undefined) assertUuid(input.campaignId, "campaignId");
  if ((input.campaignId === undefined) !== (input.campaignVersion === undefined)) {
    throw new AppError("BAD_REQUEST", "campaignId and campaignVersion go together");
  }
  const scoreplayMediaIds = input.scoreplayMediaIds ?? [
    ...new Set(media.flatMap((m) => (m.scoreplayMediaId ? [m.scoreplayMediaId] : []))),
  ];
  return {
    input: { ...input, media, decision, intent, scoreplayMediaIds },
    policyKind: policyKindOf(decision),
  };
}

function policyKindOf(decision: Decision): "VERIFIED" | "DEMO" | undefined {
  if (decision.policySelection) return decision.policySelection.kind ?? undefined;
  return decision.policyFictional ? "DEMO" : "VERIFIED";
}
