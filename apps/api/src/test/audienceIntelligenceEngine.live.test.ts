import "dotenv/config";
import { test } from "node:test";
import assert from "node:assert";
import { runAudienceIntelligence } from "../research/audience-intelligence/AudienceIntelligenceEngine.js";

// Isolated from audienceIntelligenceEngine.test.ts's no-key path — that file does a
// module-scope `delete process.env.OPENAI_API_KEY`, which freezes openaiClient.ts's
// `openai` const as null for the lifetime of that module instance. If this test lived in
// the same file/process, a later re-population of process.env.OPENAI_API_KEY (e.g. via
// another module's own "dotenv/config" import) would make a live-path test THINK it has a
// key (env check passes) while the already-frozen `openai` object stays null underneath,
// silently falling back instead of exercising the real path — same isolation issue
// imageProvider.live.test.ts/metaAdapter.live.test.ts already solve by using a dedicated file.
test("runAudienceIntelligence - live path returns a structured ICP with weighted firmographic and behavioral criteria", async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.log("Skipping — OPENAI_API_KEY not set.");
    return;
  }
  const report = await runAudienceIntelligence({ workspaceId: `ws-icp-${Date.now()}`, url: "https://stripe.com", businessName: "Stripe" });

  assert.ok(report.icp.summary.length > 0);
  assert.ok(report.icp.firmographics.length >= 2, "expected at least 2 firmographic fit criteria");
  assert.ok(report.icp.behavioralSignals.length >= 2, "expected at least 2 behavioral fit criteria");
  for (const c of [...report.icp.firmographics, ...report.icp.behavioralSignals]) {
    assert.ok(typeof c.criterion === "string" && c.criterion.length > 0);
    assert.ok(c.weight >= 0 && c.weight <= 1, `weight must be in [0,1], got ${c.weight}`);
  }
});
