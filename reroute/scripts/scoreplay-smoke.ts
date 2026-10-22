/**
 * pnpm exec tsx --env-file=.env.local scripts/scoreplay-smoke.ts [query]
 * pnpm exec tsx --env-file=.env.local scripts/scoreplay-smoke.ts --writeback <scoreplayMediaId>
 *
 * --writeback prints the DRY-RUN writeback plan for a TEST receipt (fictional demo policy, receipt id
 * `smoke-<mediaId>`). Nothing is written to ScorePlay: scripts never apply a writeback.
 */
import { RightsReceiptSchema, type RightsReceipt } from "../src/lib/contracts";
import { AppError } from "../src/lib/errors";
import { ScorePlayHttpClient } from "../src/lib/scoreplay/client";
import { planWriteback, toScorePlayActions, writebackMode } from "../src/lib/scoreplay/writeback";
import { SCOREPLAY_TAXONOMY } from "../src/lib/scoreplay/taxonomy";

async function main() {
  const args = process.argv.slice(2);
  const sp = new ScorePlayHttpClient();

  const who = await sp.whoami();
  console.log(`whoami: user=${who.user_id} type=${who.user_type} company=${who.company?.subdomain ?? "-"} rights=${(who.rights ?? []).join(",")}`);
  console.log(`taxonomy: ${SCOREPLAY_TAXONOMY.status}`);

  const wbAt = args.indexOf("--writeback");
  if (wbAt >= 0) {
    const mediaId = args[wbAt + 1];
    if (!mediaId) throw new AppError("BAD_REQUEST", "--writeback needs a ScorePlay media id");
    const receipt = testReceipt(mediaId);
    console.log(writebackMode(receipt), JSON.stringify(toScorePlayActions(planWriteback(receipt)), null, 2));
    return;
  }

  const query = args[0] ?? "";
  const assets = await sp.searchAssets(query, 5);
  console.log(`search "${query}": ${assets.length} asset(s)`);
  for (const a of assets) console.log(`  ${a.id} [${a.kind}] ${a.title} ${a.durationSec ?? "-"}s tags=${a.tags.slice(0, 6).join(", ")}`);
  const first = assets[0];
  if (!first) return;
  const asset = await sp.getAsset(first.id);
  console.log("mapped Asset:", JSON.stringify(asset, null, 2));
}

function testReceipt(mediaId: string): RightsReceipt {
  const now = new Date().toISOString();
  return RightsReceiptSchema.parse({
    id: `smoke-${mediaId}`,
    sourceAssetIds: [mediaId],
    intent: { territory: "FR", platform: "instagram", usage: "SPONSORED", competition: "NBA", publishAt: now },
    decision: {
      verdict: "BLOCKED",
      reasons: [
        {
          ruleId: "SMOKE-TEST-RULE",
          dimension: "sponsor",
          explanation: "REROUTE writeback smoke test — fictional rule, not a real rights decision",
          outcome: "DENY",
          scoreplayMediaId: mediaId,
          start: 4,
          end: 9,
        },
      ],
      missingFacts: [],
      evidence: [],
      policyVersion: "smoke",
      policyId: "smoke-test",
      policyFictional: true,
      clearance: "NONE",
      evaluatedAt: now,
    },
    edit: { id: `smoke-edit-${mediaId}`, title: "Smoke test", segments: [{ scoreplayMediaId: mediaId, start: 0, end: 15 }], derived: false },
    media: [],
    humanReviewStatus: "PENDING",
    createdAt: now,
  });
}

main().catch((err) => {
  const code = err instanceof AppError ? err.code : "ERROR";
  console.error(`[${code}] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
