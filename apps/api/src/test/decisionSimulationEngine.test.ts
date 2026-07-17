import { test } from "node:test";
import assert from "node:assert";
import { simulateStrategies } from "../research/decision/simulation-engine.js";
import type { ResearchContext } from "../research/types/index.js";
import type { CampaignStrategy } from "../research/decision/types.js";

function fakeContext(overrides: Partial<ResearchContext> = {}): ResearchContext {
  return {
    jobId: "research-1", workspaceId: "ws-1", url: "https://example.com",
    website: null, market: null, technology: null, competitors: null, keywords: null, audience: null, company: null, news: null,
    metadata: { jobId: "research-1", generatedAt: new Date().toISOString(), totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0.5 },
    ...overrides,
  };
}

function fakeStrategy(overrides: Partial<CampaignStrategy> = {}): CampaignStrategy {
  return {
    id: "strategy-a", label: "Strategy A", targetAudience: "Everyone", platforms: ["meta"],
    objective: "Awareness", budgetDailyCents: 10000, creativeDirection: "x", messaging: "x", offer: "x",
    expectedKpi: "CTR", strengths: ["cheap"], weaknesses: ["slow"], confidence: 0.6,
    ...overrides,
  };
}

test("simulateStrategies - every metric stays within 0-100", () => {
  const results = simulateStrategies([fakeStrategy(), fakeStrategy({ id: "strategy-b", confidence: 0.1, budgetDailyCents: 0 })], fakeContext());
  for (const r of results) {
    for (const key of ["reach", "competition", "expectedRoi", "risk", "budgetEfficiency", "overallScore"] as const) {
      assert.ok(r[key] >= 0 && r[key] <= 100, `${key}=${r[key]} out of [0,100]`);
    }
  }
});

test("simulateStrategies - ranks strategies by overallScore descending, rank 1 is the highest score", () => {
  const strong = fakeStrategy({ id: "strong", confidence: 0.95, platforms: ["meta", "google", "tiktok"], budgetDailyCents: 50000 });
  const weak = fakeStrategy({ id: "weak", confidence: 0.1, platforms: ["meta"], budgetDailyCents: 100 });
  const results = simulateStrategies([weak, strong], fakeContext({ market: { competitionLevel: "low, underserved niche", trends: [], dataSource: "test" } }));

  const byId = new Map(results.map((r) => [r.strategyId, r]));
  assert.strictEqual(results[0].rank, 1);
  assert.ok(byId.get("strong")!.overallScore >= byId.get("weak")!.overallScore);
  assert.deepStrictEqual(results.map((r) => r.rank), [1, 2]);
});

test("simulateStrategies - higher market/competitor intensity text raises the competition metric", () => {
  const strategy = fakeStrategy();
  const low = simulateStrategies([strategy], fakeContext({ market: { competitionLevel: "low, underserved niche market", trends: [], dataSource: "test" } }))[0];
  const high = simulateStrategies([strategy], fakeContext({ market: { competitionLevel: "highly saturated and fiercely competitive", trends: [], dataSource: "test" } }))[0];
  assert.ok(high.competition > low.competition);
});

test("simulateStrategies - more platforms and higher budget increase reach", () => {
  const context = fakeContext();
  const narrow = simulateStrategies([fakeStrategy({ platforms: ["meta"], budgetDailyCents: 1000 })], context)[0];
  const broad = simulateStrategies([fakeStrategy({ platforms: ["meta", "google", "tiktok"], budgetDailyCents: 20000 })], context)[0];
  assert.ok(broad.reach > narrow.reach);
});

test("simulateStrategies - an empty strategy list returns an empty array", () => {
  assert.deepStrictEqual(simulateStrategies([], fakeContext()), []);
});
