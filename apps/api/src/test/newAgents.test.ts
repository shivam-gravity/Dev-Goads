import { test } from "node:test";
import assert from "node:assert";
import { createAIAgents } from "../agents/agents/index.js";
import type { ResearchContext } from "../research/types/index.js";

delete process.env.OPENAI_API_KEY;

// Cache-busting dynamic import (same technique as aiAgents.test.ts) — infra/openaiClient.ts
// computes `openai` once at module-evaluation time, so every agent module needs a fresh
// module graph after deleting the env var above.
const t = Date.now();
const { LandingPageAgent } = await import(`../agents/agents/LandingPageAgent.js?t=${t}`);
const { PricingOfferAgent } = await import(`../agents/agents/PricingOfferAgent.js?t=${t}`);
const { LocalizationAgent } = await import(`../agents/agents/LocalizationAgent.js?t=${t}`);
const { SEOContentAgent } = await import(`../agents/agents/SEOContentAgent.js?t=${t}`);
const { SeasonalityTimingAgent } = await import(`../agents/agents/SeasonalityTimingAgent.js?t=${t}`);
const { ChannelPlacementAgent } = await import(`../agents/agents/ChannelPlacementAgent.js?t=${t}`);
const { FunnelRetargetingAgent } = await import(`../agents/agents/FunnelRetargetingAgent.js?t=${t}`);
const { ObjectionHandlingAgent } = await import(`../agents/agents/ObjectionHandlingAgent.js?t=${t}`);
const { ForecastingKPIAgent } = await import(`../agents/agents/ForecastingKPIAgent.js?t=${t}`);
const { ComplianceAgent } = await import(`../agents/agents/ComplianceAgent.js?t=${t}`);

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
    socialMedia: { platforms: [], overallPresence: "Unknown", dataSource: "search" },
    reviews: { topPraise: [], topComplaints: ["Support is slow"], reviewSources: ["G2"], dataSource: "search" },
    metadata: { jobId: "job-1", generatedAt: "now", totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0 },
  };
}

const PRODUCER_AGENTS = [
  { Ctor: LandingPageAgent, name: "landing-page-agent" },
  { Ctor: PricingOfferAgent, name: "pricing-offer-agent" },
  { Ctor: LocalizationAgent, name: "localization-agent" },
  { Ctor: SEOContentAgent, name: "seo-content-agent" },
  { Ctor: SeasonalityTimingAgent, name: "seasonality-timing-agent" },
  { Ctor: ChannelPlacementAgent, name: "channel-placement-agent" },
  { Ctor: FunnelRetargetingAgent, name: "funnel-retargeting-agent" },
  { Ctor: ObjectionHandlingAgent, name: "objection-handling-agent" },
  { Ctor: ForecastingKPIAgent, name: "forecasting-kpi-agent" },
];

for (const { Ctor, name } of PRODUCER_AGENTS) {
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
      assert.strictEqual(result.promptVersion, 1);
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

test("ComplianceAgent - with no prior results, reports low confidence and asks for at least one agent to run first", async () => {
  const agent = new ComplianceAgent();
  const result = await agent.execute(fixtureContext(), { priorResults: {} });
  assert.strictEqual(result.confidence, 0.1);
  assert.match(result.data.flags[0].issue, /No proposals were supplied/);
});

test("ComplianceAgent - with prior results supplied, includes each reviewed agent in its evidence trail", async () => {
  const agent = new ComplianceAgent();
  const priorResults = {
    "campaign-agent": { agent: "campaign-agent", promptId: "campaign-agent", promptVersion: 1, data: { creatives: [] }, confidence: 0.8, evidence: [], usedFallback: false, generatedAt: "now", durationMs: 1 },
  };
  const result = await agent.execute(fixtureContext(), { priorResults });
  const sources = result.evidence.map((e: { source: string }) => e.source);
  assert.ok(sources.includes("campaign-agent"), "compliance-agent's evidence must name the agent it reviewed");
});

test("all 20 agent names (10 original + 9 new producers + compliance) are distinct", () => {
  const agents = createAIAgents();
  const names = agents.map((a) => a.name);
  assert.strictEqual(agents.length, 20, `expected exactly 20 agents, got ${agents.length}`);
  assert.strictEqual(new Set(names).size, names.length, "every agent name must be unique");
});
