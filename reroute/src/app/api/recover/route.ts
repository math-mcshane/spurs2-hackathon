import { RecoverRequestSchema } from "@/lib/contracts";
import { withoutMediaUrls } from "@/lib/media/preview";
import { policiesForEvaluation, toPolicyContext } from "@/lib/rights/packages";
import { getScorePlayClient } from "@/lib/scoreplay";
import { parseBody, route } from "@/lib/server/http";
import { recover } from "@/lib/server/recovery";
import { recoveryViewOf } from "@/lib/server/recovery-view";

/** Replacement moments searched (and each re-checked) when the footage itself is the problem. */
const REPLACEMENTS = 3;

/**
 * POST /api/recover — "Find a way to use it" for any clip + cut + uses (Media Compliance Recovery Engine):
 * locates every restriction in the footage or in the plan, proposes TRIM / SAFE_SECTION / REPLACE /
 * ADAPT_CAMPAIGN / CHANGE_USAGE / REQUEST_CLEARANCE and re-checks each option independently for every use,
 * under the rule package of `intents[0].club` (+ every other club's default for their own footage).
 * → `{ recovery: RecoveryView, media: MediaRef[], notes: string[], policy: PolicyContext | null }`.
 *
 * READ-ONLY: persists nothing (no evaluation, alternatives record, event or receipt). The caller applies an
 * option to its own edit and gets its own decision (the desk re-decides via /api/decide and records receipts
 * via /api/receipts). Same-origin + rate limit ("rights", 20/min/IP) are enforced in `src/proxy.ts`.
 * The payload never carries footage URLs. A demo-policy ALLOWED is never legal clearance.
 */
export const POST = route(async (req: Request) => {
  const { edit, intents, packageId } = await parseBody(req, RecoverRequestSchema);
  const segment = edit.segments[0];
  const [asset, selection] = await Promise.all([
    getScorePlayClient().getAsset(segment.scoreplayMediaId),
    policiesForEvaluation({ club: intents[0].club ?? "", ...(packageId ? { packageId } : {}) }),
  ]);
  const { plan, media, notes } = await recover(
    {
      source: { assetId: asset.id, title: asset.title, range: { start: segment.start, end: segment.end } },
      intents,
      query: segment.label?.trim() || asset.title,
      replacements: REPLACEMENTS,
      idPrefix: edit.id,
    },
    { policies: selection.policies },
  );
  const recovery = recoveryViewOf(plan, {
    id: `${edit.id}:recovery`,
    forEvaluationId: edit.id,
    generatedAt: new Date().toISOString(),
    media,
    policyTitle: selection.package?.title ?? "Rights policy",
    ...(asset.durationSec ? { assetDurationSec: asset.durationSec } : {}),
  });
  const policy = selection.package ? toPolicyContext(selection.package) : null;
  return Response.json(withoutMediaUrls({ recovery, media, notes, policy }));
});
