import { test } from "node:test";
import assert from "node:assert";
import { think, type PlatformBrainDeps } from "../brain/PlatformBrain.js";
import type { ResearchContext } from "../research/types/index.js";
import type { DecisionContext } from "../research/decision/types.js";
import type { AgentPipelineResult } from "../agents/AgentCoordinator.js";

function fakeResearchContext(): ResearchContext {
  return {
    jobId: "research-1", workspaceId: "ws-1", url: "https://example.com",
    website: null, market: null, technology: null, competitors: null, keywords: null, audience: null, company: null, news: null,
    metadata: { jobId: "research-1", generatedAt: "now", totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0 },
  };
}

function fakeDecisionContext(): DecisionContext {
  return {
    businessSummary: "A test business.", audiencePersonas: [], topOpportunities: [], topRisks: [],
    pricingTiers: [], notableCustomers: [], quantifiedProofPoints: [], regionalMarketDepth: null,
    recommendedPositioning: "n/a", recommendedAudiencePriority: "n/a", recommendedChannels: [],
    recommendedBudgetAllocation: {}, recommendedDailyBudgetCents: 0, budgetReasoning: [],
    recommendedCreativeDirection: "n/a", recommendedOffer: "n/a",
    recommendedMessaging: "n/a",
    swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] }, marketGaps: [], funnelStrategy: "n/a", mediaStrategy: "n/a",
    confidence: 0.5, evidence: [], tradeoffs: [],
    recommendations: [], tradeoffAnalyses: [], explainability: [], strategies: [], simulations: [],
    generatedAt: "now",
  };
}

function fakeAgentPipelineResult(): AgentPipelineResult {
  return { results: { "campaign-agent": { agent: "campaign-agent", promptId: "campaign-agent", promptVersion: 1, data: {}, confidence: 0.9, evidence: [], usedFallback: false, generatedAt: "now", durationMs: 1 } }, order: ["campaign-agent"] };
}

function fakeDeps(overrides: Partial<PlatformBrainDeps> = {}): PlatformBrainDeps {
  return {
    async runDecisionEngine() { return fakeDecisionContext(); },
    async runIntelligenceEnrichment() { return { landingPage: null }; },
    async runAgentCoordinator() { return fakeAgentPipelineResult(); },
    ...overrides,
  };
}

test("PlatformBrain.think - combines Decision Engine, Intelligence Enrichment, and Agent Coordinator output from one shared context", async () => {
  const context = fakeResearchContext();
  let decisionContextSeen: ResearchContext | undefined;
  let enrichmentContextSeen: ResearchContext | undefined;
  let agentsContextSeen: ResearchContext | undefined;

  const deps = fakeDeps({
    async runDecisionEngine(ctx) { decisionContextSeen = ctx; return fakeDecisionContext(); },
    async runIntelligenceEnrichment(ctx) { enrichmentContextSeen = ctx; return { landingPage: null }; },
    async runAgentCoordinator(ctx) { agentsContextSeen = ctx; return fakeAgentPipelineResult(); },
  });

  const result = await think(context, { deps });

  assert.strictEqual(decisionContextSeen, context, "Decision Engine must see the same ResearchContext passed to think()");
  assert.strictEqual(enrichmentContextSeen, context, "Intelligence Enrichment must see the same ResearchContext passed to think()");
  assert.strictEqual(agentsContextSeen, context, "Agent Coordinator must see the same ResearchContext passed to think()");
  assert.strictEqual(result.decision?.businessSummary, "A test business.");
  assert.strictEqual(result.intelligenceEnrichment.landingPage, null);
  assert.ok(result.agents.results["campaign-agent"]);
});

test("PlatformBrain.think - a Decision Engine failure degrades to null rather than throwing", async () => {
  const deps = fakeDeps({ async runDecisionEngine() { throw new Error("decision engine exploded"); } });

  const result = await think(fakeResearchContext(), { deps });

  assert.strictEqual(result.decision, null);
  assert.ok(result.agents.results["campaign-agent"], "agents must still run despite the Decision Engine failing");
});

test("PlatformBrain.think - an Intelligence Enrichment failure degrades to {landingPage: null} rather than throwing", async () => {
  const deps = fakeDeps({ async runIntelligenceEnrichment() { throw new Error("enrichment exploded"); } });

  const result = await think(fakeResearchContext(), { deps });

  assert.deepStrictEqual(result.intelligenceEnrichment, { landingPage: null });
  assert.ok(result.agents.results["campaign-agent"], "agents must still run despite Intelligence Enrichment failing");
});

test("PlatformBrain.think - an Agent Coordinator failure propagates (the one hard dependency), unlike Decision Engine/Intelligence Enrichment", async () => {
  const deps = fakeDeps({ async runAgentCoordinator() { throw new Error("agent coordinator exploded"); } });

  await assert.rejects(() => think(fakeResearchContext(), { deps }), /agent coordinator exploded/);
});

test("PlatformBrain.think - passes onAgentProgress through to the Agent Coordinator unchanged", async () => {
  const progressCalls: Array<[number, number, string | undefined]> = [];
  const deps = fakeDeps({
    async runAgentCoordinator(_ctx, options) {
      await options?.onProgress?.(1, 1, "campaign-agent");
      return fakeAgentPipelineResult();
    },
  });

  await think(fakeResearchContext(), {
    deps,
    onAgentProgress: async (completed, total, agentName) => { progressCalls.push([completed, total, agentName]); },
  });

  assert.deepStrictEqual(progressCalls, [[1, 1, "campaign-agent"]]);
});
