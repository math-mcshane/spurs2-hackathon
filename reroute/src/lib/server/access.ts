import type { AccessResponseSchema, EditPlan, PublishIntent } from "@/lib/contracts";
import type { z } from "zod";
import { decideEdit } from "./decide";
import { createReceipt } from "./store";

/**
 * App-level gate (spec §4.6). Always re-evaluates server-side; a client-sent verdict is never trusted.
 * ALLOWED ⇒ USE; BLOCKED ⇒ BLOCKED; NEEDS_REVIEW ⇒ REQUEST_REVIEW with a fresh PENDING receipt.
 * Every action (PREVIEW/EXPORT/RENDER/DELIVER) requires ALLOWED. This gates REROUTE actions only;
 * it does not change ScorePlay ACLs.
 */
export async function checkAccess(
  edit: EditPlan,
  intent: PublishIntent,
): Promise<z.infer<typeof AccessResponseSchema>> {
  const { decision } = await decideEdit(edit, intent);
  switch (decision.verdict) {
    case "ALLOWED":
      return { granted: true, uiAction: "USE", decision };
    case "BLOCKED":
      return { granted: false, uiAction: "BLOCKED", decision };
    case "NEEDS_REVIEW": {
      const receipt = await createReceipt({ edit, intent, decision });
      return { granted: false, uiAction: "REQUEST_REVIEW", decision, receiptId: receipt.id };
    }
  }
}
