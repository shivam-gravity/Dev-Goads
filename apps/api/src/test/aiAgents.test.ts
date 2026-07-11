import { test } from "node:test";
import assert from "node:assert";
import type { ResearchContext } from "../research/types/index.js";
import type { AgentEvidenceItem } from "../agents/types/index.js";

delete process.env.OPENAI_API_KEY;

// Cache-busting dynamic import (same technique as marketResearch.test.ts /
// researchProviders.test.ts): infra/openaiClient.ts computes `openai` once at
// module-evaluation time, so every agent module (which reaches it transitively through
// agents/support.ts) needs a fresh module graph after deleting the env var above.
const t = Date.now();
const { ProductAgent } = await import(`../agents/agents/ProductAgent.js?t=${t}`);
const { AudienceAgent } = await import(`../agents/agents/AudienceAgent.js?t=${t}`);
const { CompetitorAgent } = await import(`../agents/agents/CompetitorAgent.js?t=${t}`);
const { MarketAgent } = await import(`../agents/agents/MarketAgent.js?t=${t}`);
const { KeywordAgent } = await import(`../agents/agents/KeywordAgent.js?t=${t}`);
const { CreativeAgent } = await import(`../agents/agents/CreativeAgent.js?t=${t}`);
const { BudgetAgent } = await import(`../agents/agents/BudgetAgent.js?t=${t}`);
const { PersonaAgent } = await import(`../agents/agents/PersonaAgent.js?t=${t}`);
const { CampaignAgent } = await import(`../agents/agents/CampaignAgent.js?t=${t}`);
const { CriticAgent } = await import(`../agents/agents/CriticAgent.js?t=${t}`);
// Plain (non-busted) import intentionally shares the same singleton the busted agent
// modules use — their static imports resolve without the query param, so it's one registry.
const { promptRegistry } = await import("../agents/prompts/PromptRegistry.js");

function fixtureContext(): ResearchContext {
  return {
    jobId: "job-1",
    workspaceId: "ws-1",
    url: "https://example.com",
    website: { title: "Acme Widgets", description: "We sell widgets", excerpt: "e", images: [], crawledPages: [], pagesDiscovered: 1, dataSource: "crawl" },
    market: { trends: ["growing"], competitionLevel: "medium", dataSource: "search" },
    technology: { analyticsTools: [], frameworks: [], detectedFrom: [], dataSource: "signature" },
    competitors: { competitors: [{ name: "Rival Co" }], competitionIntensity: "high", differentiators: ["price"], dataSource: "search" },
    keywords: { primaryKeywords: ["widgets", "quality"], headings: ["Premium Widgets"], dataSource: "on-page" },
    audience: { primaryAudience: "SMBs", segments: [{ name: "New customers", description: "first-timers" }], painPoints: ["cost"], interestTags: ["widgets"], dataSource: "search" },
    company: { name: "Acme Widgets Inc", summary: "Makes widgets", dataSource: "search" },
    news: { articles: [], summary: "no news", dataSource: "search" },
    metadata: { jobId: "job-1", generatedAt: "now", totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0 },
  };
}

const AGENTS = [
  { Ctor: ProductAgent, name: "product-agent" },
  { Ctor: AudienceAgent, name: "audience-agent" },
  { Ctor: CompetitorAgent, name: "competitor-agent" },
  { Ctor: MarketAgent, name: "market-agent" },
  { Ctor: KeywordAgent, name: "keyword-agent" },
  { Ctor: CreativeAgent, name: "creative-agent" },
  { Ctor: BudgetAgent, name: "budget-agent" },
  { Ctor: PersonaAgent, name: "persona-agent" },
  { Ctor: CampaignAgent, name: "campaign-agent" },
];

for (const { Ctor, name } of AGENTS) {
  test(`${name} - degrades to a labeled fallback with zero network calls when OPENAI_API_KEY is unset`, async () => {
    const original = global.fetch;
    let fetchCalled = false;
    global.fetch = (async () => {
      fetchCalled = true;
      throw new Error("should not be called");
    }) as typeof fetch;

    try {
      const agent = new Ctor();
      const result = await agent.execute(fixtureContext());

      assert.strictEqual(result.agent, name);
      assert.strictEqual(result.promptId, name);
      // Agents always run the registry's latest prompt version (render() with no pin) —
      // compare against the registry rather than hardcoding, so registering a v2 prompt
      // (e.g. the fact-grounded creative/campaign/critic prompts) doesn't break this test.
      assert.strictEqual(result.promptVersion, promptRegistry.get(name).version);
      assert.strictEqual(result.usedFallback, true);
      assert.strictEqual(result.confidence, 0.2, "no-API-key runs must report the flat fallback confidence");
      assert.ok(Array.isArray(result.evidence) && result.evidence.length > 0, "every agent must include a non-empty evidence trail");
      assert.ok(result.data && typeof result.data === "object", "every agent must return a JSON-shaped data object");
      assert.strictEqual(fetchCalled, false, "no OPENAI_API_KEY should mean zero network calls");
    } finally {
      global.fetch = original;
    }
  });
}

test("PersonaAgent - fallback builds one persona per audience segment when no model is available", async () => {
  const agent = new PersonaAgent();
  const result = await agent.execute(fixtureContext());
  assert.strictEqual(result.data.personas.length, 1);
  assert.strictEqual(result.data.personas[0].name, "New customers");
});

test("CriticAgent - with no prior results, reports zero confidence/score and asks for at least one agent to run first", async () => {
  const agent = new CriticAgent();
  const result = await agent.execute(fixtureContext(), { priorResults: {} });
  assert.strictEqual(result.confidence, 0.1);
  assert.strictEqual(result.data.overallScore, 0);
  assert.match(result.data.recommendation, /before requesting a critique/);
});

test("CriticAgent - with prior results supplied, includes each reviewed agent in its evidence trail", async () => {
  const agent = new CriticAgent();
  const priorResults = {
    "product-agent": {
      agent: "product-agent", promptId: "product-agent", promptVersion: 1,
      data: { productName: "Acme" }, confidence: 0.8, evidence: [], usedFallback: false,
      generatedAt: "now", durationMs: 1,
    },
  };
  const result = await agent.execute(fixtureContext(), { priorResults });
  assert.ok(result.evidence.some((e: AgentEvidenceItem) => e.source === "product-agent" && /Reviewed/.test(e.detail)));
  assert.strictEqual(result.confidence, 0.2, "no-API-key run with non-empty proposals still floors at the fallback confidence, not the empty-proposals 0.1");
});

test("CampaignAgent - does not require any other agent's output to run (independently testable)", async () => {
  const agent = new CampaignAgent();
  const result = await agent.execute(fixtureContext());
  assert.ok(Array.isArray(result.data.recommendedNetworks) && result.data.recommendedNetworks.length > 0);
  assert.ok(Array.isArray(result.data.creatives) && result.data.creatives.length > 0);
});
