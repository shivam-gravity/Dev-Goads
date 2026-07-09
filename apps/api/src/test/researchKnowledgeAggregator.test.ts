import { test } from "node:test";
import assert from "node:assert";
import { aggregateResearch } from "../research/knowledge/KnowledgeAggregator.js";
import type { ProviderResult } from "../research/types/index.js";

function result<T>(provider: string, status: "success" | "partial" | "failed", data: T | null): ProviderResult<T> {
  return {
    provider,
    status,
    data,
    citations: [],
    evidence: [],
    startedAt: new Date(Date.now() - 100).toISOString(),
    completedAt: new Date().toISOString(),
    durationMs: 100,
    attempt: 1,
    confidence: status === "success" ? 0.6 : status === "partial" ? 0.3 : 0,
  };
}

test("KnowledgeAggregator - maps each provider's valid data onto its ResearchContext field", () => {
  const context = aggregateResearch({
    jobId: "job-1",
    workspaceId: "ws-1",
    url: "https://example.com",
    results: [
      result("website", "success", {
        title: "Example", description: "desc", excerpt: "excerpt", images: [], crawledPages: ["https://example.com"],
        pagesDiscovered: 1, dataSource: "crawl",
      }),
      result("company", "success", { name: "Example Inc", summary: "A company", dataSource: "search" }),
      result("market", "success", { trends: ["growing"], competitionLevel: "medium", dataSource: "search" }),
      result("competitor", "success", { competitors: [{ name: "Rival" }], competitionIntensity: "high", differentiators: ["price"], dataSource: "search" }),
      result("audience", "success", { primaryAudience: "SMBs", segments: [], painPoints: [], interestTags: [], dataSource: "search" }),
      result("technology", "success", { analyticsTools: ["Google Analytics"], frameworks: [], detectedFrom: ["markup"], dataSource: "signature" }),
      result("seo", "success", { primaryKeywords: ["widgets"], headings: [], dataSource: "on-page" }),
      result("news", "success", { articles: [], summary: "no news", dataSource: "search" }),
      result("search", "success", { narrative: "general overview", searchesUsed: 1, dataSource: "search" }),
    ],
  });

  assert.strictEqual(context.website?.title, "Example");
  assert.strictEqual(context.company?.name, "Example Inc");
  assert.strictEqual(context.market?.competitionLevel, "medium");
  assert.strictEqual(context.competitors?.competitors[0]?.name, "Rival");
  assert.strictEqual(context.audience?.primaryAudience, "SMBs");
  assert.strictEqual(context.technology?.analyticsTools[0], "Google Analytics");
  assert.strictEqual(context.keywords?.primaryKeywords[0], "widgets");
  assert.strictEqual(context.news?.summary, "no news");
  assert.strictEqual(context.metadata.generalSearch?.narrative, "general overview");
  assert.deepStrictEqual(context.metadata.providersSucceeded.sort(), [
    "audience", "company", "competitor", "market", "news", "search", "seo", "technology", "website",
  ]);
  assert.deepStrictEqual(context.metadata.providersFailed, []);
});

test("KnowledgeAggregator - a failed provider becomes a null field and lands in providersFailed", () => {
  const context = aggregateResearch({
    jobId: "job-2",
    workspaceId: "ws-1",
    url: "https://example.com",
    results: [result("website", "failed", null)],
  });

  assert.strictEqual(context.website, null);
  assert.deepStrictEqual(context.metadata.providersFailed, ["website"]);
  assert.deepStrictEqual(context.metadata.providersSucceeded, []);
});

test("KnowledgeAggregator - data that fails schema validation degrades to null rather than polluting the context", () => {
  const context = aggregateResearch({
    jobId: "job-3",
    workspaceId: "ws-1",
    url: "https://example.com",
    // Reports "success" but the payload is missing required fields — must not be trusted.
    results: [result("company", "success", { name: "Example Inc" } as any)],
  });

  assert.strictEqual(context.company, null);
});

test("KnowledgeAggregator - a missing provider (never ran) is null and absent from all metadata buckets", () => {
  const context = aggregateResearch({ jobId: "job-4", workspaceId: "ws-1", url: "https://example.com", results: [] });
  assert.strictEqual(context.website, null);
  assert.strictEqual(context.company, null);
  assert.strictEqual(context.metadata.providersSucceeded.length, 0);
  assert.strictEqual(context.metadata.providersFailed.length, 0);
});
