import { test } from "node:test";
import assert from "node:assert";
import { computeConfidence, collectEvidence } from "../agents/support.js";
import type { ResearchContext } from "../research/types/index.js";

function fixtureContext(overrides: Partial<ResearchContext> = {}): ResearchContext {
  return {
    jobId: "job-1",
    workspaceId: "ws-1",
    url: "https://example.com",
    website: { title: "t", description: "d", excerpt: "e", images: [], crawledPages: [], pagesDiscovered: 1, dataSource: "crawl" },
    market: null,
    technology: null,
    competitors: null,
    keywords: null,
    audience: null,
    company: null,
    news: null,
    metadata: { jobId: "job-1", generatedAt: "now", totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0 },
    ...overrides,
  };
}

test("computeConfidence - forces the fallback floor whenever usedFallback is true, regardless of data completeness", () => {
  const context = fixtureContext({ company: { name: "n", summary: "s", dataSource: "d" } });
  assert.strictEqual(computeConfidence(context, ["website", "company"], true), 0.2);
});

test("computeConfidence - is penalized per missing field and floors at 0.2", () => {
  const context = fixtureContext();
  const withOneMissing = computeConfidence(context, ["website", "market"], false); // market is null
  const withAllPresent = computeConfidence(context, ["website"], false);
  assert.ok(withOneMissing < withAllPresent, "a missing dependency should score lower than none missing");
  assert.ok(withAllPresent <= 0.95 && withAllPresent > 0);

  const allMissing = computeConfidence(context, ["market", "technology", "competitors", "keywords", "audience", "company", "news"], false);
  assert.strictEqual(allMissing, 0.2, "score should floor at 0.2, never go negative");
});

test("collectEvidence - pulls each field's dataSource label when present", () => {
  const context = fixtureContext();
  const evidence = collectEvidence(context, ["website", "market"]);
  assert.deepStrictEqual(evidence, [
    { source: "website", detail: "crawl" },
    { source: "market", detail: "market was not available in this ResearchContext" },
  ]);
});
