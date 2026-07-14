import { test } from "node:test";
import assert from "node:assert";
import { buildCompanyProfileData } from "../research/company-knowledge/CompanyKnowledgeBuilder.js";
import type { ResearchContext } from "../research/types/index.js";
import type { VerifiedFact } from "../agents/crawlFacts.js";

function fakeContext(overrides: Partial<ResearchContext> = {}): ResearchContext {
  return {
    jobId: "job-1",
    workspaceId: "ws-1",
    url: "https://example.com",
    website: null,
    market: null,
    technology: null,
    competitors: null,
    keywords: null,
    audience: null,
    company: null,
    news: null,
    metadata: {
      jobId: "job-1", generatedAt: "now", totalDurationMs: 0,
      providersSucceeded: [], providersPartial: [], providersFailed: [],
      confidenceByProvider: {}, overallConfidence: 0,
    },
    ...overrides,
  };
}

test("CompanyKnowledgeBuilder - assembles overview/positioning from company + competitor differentiators", () => {
  const context = fakeContext({
    company: { name: "Acme", summary: "Acme sells widgets online.", dataSource: "search" },
    competitors: { competitors: [], competitionIntensity: "Moderate", differentiators: ["faster shipping", "lower price"], dataSource: "search" },
  });

  const data = buildCompanyProfileData(context, null, []);
  assert.strictEqual(data.overview, "Acme sells widgets online.");
  assert.ok(data.positioning.includes("faster shipping"), `expected differentiators folded in, got: ${data.positioning}`);
});

test("CompanyKnowledgeBuilder - splits product entries into products vs services by priceText/availability", () => {
  const context = fakeContext({
    product: {
      products: [
        { name: "Pro Plan", priceText: "$49/mo", features: ["API access", "Priority support"] },
        { name: "Consulting", features: ["Custom onboarding"] },
      ],
      dataSource: "firecrawl",
    },
  });

  const data = buildCompanyProfileData(context, null, []);
  assert.deepStrictEqual(data.products, ["Pro Plan"]);
  assert.deepStrictEqual(data.services, ["Consulting"]);
  assert.ok(data.features.includes("API access"));
  assert.ok(data.pricing.includes("$49/mo"));
});

test("CompanyKnowledgeBuilder - falls back to the Business record's industry/targetAudience when research didn't determine them", () => {
  const context = fakeContext();
  const data = buildCompanyProfileData(context, { industry: "B2B SaaS", targetAudience: "Mid-market IT teams" }, []);

  assert.deepStrictEqual(data.industries, ["B2B SaaS"]);
  assert.strictEqual(data.targetAudience, "Mid-market IT teams");
});

test("CompanyKnowledgeBuilder - derives FAQs only from facts whose field reads like real FAQ material", () => {
  const facts: VerifiedFact[] = [
    { field: "guarantee", value: "30-day money-back guarantee", sourceUrl: "https://example.com/refunds", confidence: 0.8 },
    { field: "product.name", value: "Widget Pro", sourceUrl: "https://example.com", confidence: 0.9 },
  ];

  const data = buildCompanyProfileData(fakeContext(), null, facts);
  assert.strictEqual(data.faqs.length, 1);
  assert.strictEqual(data.faqs[0]?.answer, "30-day money-back guarantee");
});

test("CompanyKnowledgeBuilder - degrades gracefully to labeled placeholders when research found nothing", () => {
  const data = buildCompanyProfileData(fakeContext(), null, []);
  assert.strictEqual(data.products.length, 0);
  assert.strictEqual(data.pricing, "Pricing not determined by current research");
  assert.strictEqual(data.targetAudience, "Not determined by current research");
  assert.strictEqual(data.positioning, "Not determined by current research");
});
