import "dotenv/config";
import { test, after } from "node:test";
import assert from "node:assert";
import { runIntelligenceEnrichment } from "../research/intelligenceEnrichment.js";
import { getMetadataByDedupKey } from "../research/memory/MemoryCoordinator.js";
import type { ResearchContext } from "../research/types/index.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

after(disconnectTestInfra);

/**
 * Proves runIntelligenceEnrichment actually closes the gap the codebase survey found:
 * explainRecommendations (research/decision/explainability.ts) queries Research Memory
 * kinds "creative-analysis" and "pricing-analysis" for every creative/messaging/offer
 * recommendation, but nothing ever wrote to those kinds in production — Creative and
 * Pricing Intelligence were fully built and tested, just never invoked outside their own
 * test files. This runs the real enrichment pass end to end (real OpenAI calls, real
 * Research Memory writes) and checks the memory rows actually land.
 *
 * Deliberately does NOT test the "no OPENAI_API_KEY" fallback path here — mutating
 * process.env.OPENAI_API_KEY after this file's imports already ran wouldn't actually
 * change the already-instantiated openai client the 3 sub-engines hold (each reads it
 * once at their own module load time), and each sub-engine already has its own dedicated
 * no-key test (creativeIntelligenceEngine.test.ts etc.) — re-testing that here would be
 * both redundant and misleading.
 */

function fakeContext(overrides: Partial<ResearchContext> = {}): ResearchContext {
  return {
    jobId: "research-1", workspaceId: `ws-enrich-${Date.now()}`, url: "https://example.com",
    website: null, market: null, technology: null, keywords: null, audience: null, news: null,
    company: { name: "Acme Example", summary: "Acme sells widgets.", dataSource: "test" },
    competitors: null,
    metadata: { jobId: "research-1", generatedAt: new Date().toISOString(), totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0 },
    ...overrides,
  };
}

test("runIntelligenceEnrichment - with no competitors in the ResearchContext, still completes without throwing (Creative/Pricing skipped, Landing-Page still runs)", async () => {
  const context = fakeContext({ competitors: { competitors: [], competitionIntensity: "Unknown", differentiators: [], dataSource: "test" } });
  await assert.doesNotReject(() => runIntelligenceEnrichment(context));
});

test("runIntelligenceEnrichment - with null competitors, still completes without throwing", async () => {
  const context = fakeContext({ competitors: null });
  await assert.doesNotReject(() => runIntelligenceEnrichment(context));
});

test("runIntelligenceEnrichment - with real competitors and OPENAI_API_KEY, writes real creative-analysis and pricing-analysis Research Memory entries", async () => {
  if (!process.env.OPENAI_API_KEY) {
    console.log("Skipping — OPENAI_API_KEY not set.");
    return;
  }

  const workspaceId = `ws-enrich-${Date.now()}`;
  const context = fakeContext({
    workspaceId,
    competitors: {
      competitors: [{ name: "Stripe", url: "https://stripe.com", notes: "Payments platform" }],
      competitionIntensity: "High",
      differentiators: ["Developer experience"],
      dataSource: "test",
    },
  });

  await runIntelligenceEnrichment(context);

  const creativeMeta = await getMetadataByDedupKey("creative-analysis", workspaceId, "stripe");
  const pricingMeta = await getMetadataByDedupKey("pricing-analysis", workspaceId, "stripe");

  assert.ok(creativeMeta, "expected a creative-analysis Research Memory entry for the analyzed competitor — this is the exact memory kind explainRecommendations reads and previously always got zero matches from");
  assert.ok(pricingMeta, "expected a pricing-analysis Research Memory entry for the analyzed competitor");
});
