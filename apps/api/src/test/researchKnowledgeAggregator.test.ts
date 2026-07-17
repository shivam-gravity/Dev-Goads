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

  // Knowledge Fusion Engine output is attached additively — every provider here reported
  // "success" at confidence 0.6 (above the low-grounding threshold) with a "medium" vs.
  // "high" competition reading (not opposite extremes), so no conflicts should fire.
  assert.strictEqual(context.metadata.fusion?.explainability.length, 9);
  assert.strictEqual(context.metadata.fusion?.authorityByProvider.website, 0.95);
  assert.deepStrictEqual(context.metadata.fusion?.conflicts, []);
});

test("KnowledgeAggregator - maps all 7 Firecrawl-backed crawler-batch providers onto their ResearchContext fields", () => {
  const context = aggregateResearch({
    jobId: "job-crawler-batch",
    workspaceId: "ws-1",
    url: "https://example.com",
    results: [
      result("product", "success", { products: [{ name: "Widget Pro", features: ["fast"] }], dataSource: "firecrawl" }),
      result("navigation", "success", { pages: [{ url: "https://example.com/pricing", pageType: "pricing", discovered: true }], totalDiscovered: 1, dataSource: "firecrawl" }),
      result("search-ranking", "success", { rankings: [{ query: "widgets", position: 1, title: "Widget Pro", url: "https://example.com" }], dataSource: "firecrawl" }),
      result("ad-library", "success", { ads: [{ platform: "meta", advertiserName: "Example Inc", sourceUrl: "https://facebook.com/ads/1" }], dataSource: "meta" }),
      result("autocomplete", "success", { suggestions: ["widgets near me"], dataSource: "autocomplete" }),
      result("serp-features", "success", { peopleAlsoAsk: ["what is a widget"], relatedSearches: ["gadgets"], dataSource: "serp" }),
      result("reddit", "success", { threads: [{ title: "Anyone use Widget Pro?", url: "https://reddit.com/r/widgets/1", sentiment: "positive" }], summary: "Mostly positive", dataSource: "reddit" }),
    ],
  });

  assert.strictEqual(context.product?.products[0]?.name, "Widget Pro");
  assert.strictEqual(context.navigation?.pages[0]?.pageType, "pricing");
  assert.strictEqual(context.searchRanking?.rankings[0]?.position, 1);
  assert.strictEqual(context.adLibrary?.ads[0]?.advertiserName, "Example Inc");
  assert.strictEqual(context.autocomplete?.suggestions[0], "widgets near me");
  assert.strictEqual(context.serpFeatures?.peopleAlsoAsk[0], "what is a widget");
  assert.strictEqual(context.communityDiscussion?.threads[0]?.sentiment, "positive");
});

test("KnowledgeAggregator - preserves audience's decision-maker/buying-committee/customer-journey fields instead of silently stripping them", () => {
  const context = aggregateResearch({
    jobId: "job-audience-fields",
    workspaceId: "ws-1",
    url: "https://example.com",
    results: [
      result("audience", "success", {
        primaryAudience: "B2B SaaS buyers",
        segments: [{ name: "IT Directors", description: "Evaluate tooling" }],
        painPoints: ["Slow onboarding"],
        interestTags: ["saas"],
        buyingCommittee: [{ role: "IT Director", influence: "Final approver" }],
        decisionHierarchy: "IT Director reports to VP Eng",
        budgetOwner: "VP Engineering",
        procurementCycle: "6-8 weeks",
        buyingTriggers: ["New fiscal year budget"],
        customerJourney: [{ stage: "Awareness", description: "Finds via search" }],
        dataSource: "search",
      }),
    ],
  });

  assert.strictEqual(context.audience?.buyingCommittee?.[0]?.role, "IT Director");
  assert.strictEqual(context.audience?.decisionHierarchy, "IT Director reports to VP Eng");
  assert.strictEqual(context.audience?.budgetOwner, "VP Engineering");
  assert.strictEqual(context.audience?.procurementCycle, "6-8 weeks");
  assert.strictEqual(context.audience?.buyingTriggers?.[0], "New fiscal year budget");
  assert.strictEqual(context.audience?.customerJourney?.[0]?.stage, "Awareness");
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

test("KnowledgeAggregator - reconciles an 'unknown' company fundingStage with a real funding article NewsProvider independently found", () => {
  const context = aggregateResearch({
    jobId: "job-5",
    workspaceId: "ws-1",
    url: "https://example.com",
    results: [
      result("company", "success", { name: "Acme Inc", summary: "A company", fundingStage: "Unknown", dataSource: "search" }),
      result("news", "success", {
        articles: [{ title: "Acme raises $40M Series B to expand platform", url: "https://news.example.com/acme-series-b" }],
        summary: "Acme in the news",
        dataSource: "search",
      }),
    ],
  });

  assert.ok(context.company?.fundingStage?.includes("Series B"), `expected the funding article to be folded in, got: ${context.company?.fundingStage}`);
});

test("KnowledgeAggregator - does not override a real fundingStage CompanyProvider already reported", () => {
  const context = aggregateResearch({
    jobId: "job-6",
    workspaceId: "ws-1",
    url: "https://example.com",
    results: [
      result("company", "success", { name: "Acme Inc", summary: "A company", fundingStage: "Series C", dataSource: "search" }),
      result("news", "success", {
        articles: [{ title: "Acme raises $5M seed round", url: "https://news.example.com/acme-seed" }],
        summary: "Acme in the news",
        dataSource: "search",
      }),
    ],
  });

  assert.strictEqual(context.company?.fundingStage, "Series C", "CompanyProvider's own real funding stage must win over a news mention");
});

test("KnowledgeAggregator - leaves fundingStage alone when no news article mentions funding", () => {
  const context = aggregateResearch({
    jobId: "job-7",
    workspaceId: "ws-1",
    url: "https://example.com",
    results: [
      result("company", "success", { name: "Acme Inc", summary: "A company", fundingStage: "Unknown", dataSource: "search" }),
      result("news", "success", {
        articles: [{ title: "Acme launches a new product feature", url: "https://news.example.com/acme-feature" }],
        summary: "Acme in the news",
        dataSource: "search",
      }),
    ],
  });

  assert.strictEqual(context.company?.fundingStage, "Unknown");
});
