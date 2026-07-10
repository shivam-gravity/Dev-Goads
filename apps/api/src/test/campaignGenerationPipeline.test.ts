import { test } from "node:test";
import assert from "node:assert";
import { runCampaignGenerationPipeline, type CampaignGenerationDeps } from "../modules/orchestrator/campaignGenerationPipeline.js";
import type { CampaignGenerationJobRecord, CampaignGenerationStatus } from "../modules/orchestrator/campaignGenerationService.js";
import type { ResearchJobRecord } from "../research/research-orchestrator/researchJobService.js";
import type { ResearchContext } from "../research/types/index.js";
import type { AgentPipelineResult } from "../agents/AgentCoordinator.js";
import type { AgentResult, BudgetAgentOutput, CampaignAgentOutput } from "../agents/types/index.js";
import type { AdStrategy, BusinessProfile, Campaign } from "../types/index.js";
import type { DecisionContext } from "../research/decision/types.js";

function fakeGenerationJob(overrides: Partial<CampaignGenerationJobRecord> = {}): CampaignGenerationJobRecord {
  const now = new Date().toISOString();
  return {
    id: "gen-1", workspaceId: "ws-1", businessId: "biz-1", url: "https://example.com",
    status: "pending", agentResults: null, decisionContext: null, createdAt: now, updatedAt: now, ...overrides,
  };
}

function fakeDecisionContext(): DecisionContext {
  return {
    businessSummary: "A test business.", audiencePersonas: [], topOpportunities: [], topRisks: [],
    pricingTiers: [], notableCustomers: [], quantifiedProofPoints: [], regionalMarketDepth: null,
    recommendedPositioning: "n/a", recommendedAudiencePriority: "n/a", recommendedChannels: [],
    recommendedBudgetAllocation: {}, recommendedDailyBudgetCents: 0, budgetReasoning: [],
    recommendedCreativeDirection: "n/a", recommendedOffer: "n/a",
    recommendedMessaging: "n/a", confidence: 0.5, evidence: [], tradeoffs: [],
    recommendations: [], tradeoffAnalyses: [], explainability: [], strategies: [], simulations: [],
    generatedAt: "now",
  };
}

function fakeResearchContext(): ResearchContext {
  return {
    jobId: "research-1", workspaceId: "ws-1", url: "https://example.com",
    website: null, market: null, technology: null, competitors: null, keywords: null, audience: null, company: null, news: null,
    metadata: { jobId: "research-1", generatedAt: "now", totalDurationMs: 0, providersSucceeded: [], providersPartial: [], providersFailed: [], confidenceByProvider: {}, overallConfidence: 0 },
  };
}

function fakeCampaignAgentResult(): AgentResult<CampaignAgentOutput> {
  return {
    agent: "campaign-agent", promptId: "campaign-agent", promptVersion: 1,
    data: { summary: "A strategy", recommendedNetworks: ["meta"], budgetSplit: { meta: 1 }, audiences: ["Everyone"], creatives: [{ headline: "Hi", body: "Body", callToAction: "Go" }] },
    confidence: 0.9, evidence: [], usedFallback: false, generatedAt: "now", durationMs: 1,
  };
}

function fakeBudgetAgentResult(dailyBudgetCents: number): AgentResult<BudgetAgentOutput> {
  return {
    agent: "budget-agent", promptId: "budget-agent", promptVersion: 1,
    data: { recommendedDailyBudgetCents: dailyBudgetCents, reasoning: ["because"] } as BudgetAgentOutput,
    confidence: 0.9, evidence: [], usedFallback: false, generatedAt: "now", durationMs: 1,
  };
}

interface FakeDeps extends CampaignGenerationDeps {
  statusHistory: CampaignGenerationStatus[];
  persistedAgentResults: Record<string, AgentResult<unknown>> | null;
  persistedDecisionContext: DecisionContext | null;
}

/** Builds a fully injectable CampaignGenerationDeps so the pipeline's sequencing logic
 * (research -> aggregate -> agents -> strategy -> campaign build -> persist) is testable
 * without Postgres/Redis/OpenAI — mirrors researchOrchestrator.test.ts's fakeDeps. */
function fakeDeps(opts: {
  job: CampaignGenerationJobRecord;
  agentResults?: Record<string, AgentResult<unknown>>;
  business?: BusinessProfile | null;
}): FakeDeps {
  const statusHistory: CampaignGenerationStatus[] = [];
  let persistedAgentResults: Record<string, AgentResult<unknown>> | null = null;
  let persistedDecisionContext: DecisionContext | null = null;
  const agentResults = opts.agentResults ?? { "campaign-agent": fakeCampaignAgentResult(), "budget-agent": fakeBudgetAgentResult(5000) };

  const researchJobRecord: ResearchJobRecord = {
    id: "research-1", workspaceId: opts.job.workspaceId, businessId: opts.job.businessId, url: opts.job.url,
    status: "pending", context: null, createdAt: "now", updatedAt: "now",
  };

  const strategy: AdStrategy = {
    id: "strategy-1", businessId: opts.job.businessId, summary: "A strategy",
    recommendedNetworks: ["meta"], budgetSplit: { meta: 1 }, audiences: ["Everyone"],
    creatives: [{ headline: "Hi", body: "Body", callToAction: "Go" }], createdAt: "now",
  };

  const campaign: Campaign = {
    id: "campaign-1", businessId: opts.job.businessId, strategyId: strategy.id, name: "Test Campaign",
    status: "draft", networks: ["meta"], dailyBudgetCents: 5000, variants: [], createdAt: "now", updatedAt: "now",
  };

  return {
    statusHistory,
    get persistedAgentResults() { return persistedAgentResults; },
    get persistedDecisionContext() { return persistedDecisionContext; },
    async loadJob() { return opts.job; },
    async markStatus(_id, status) { statusHistory.push(status); },
    async persistAgentResults(_id, results) { persistedAgentResults = results; },
    async persistDecisionContext(_id, decisionContext) { persistedDecisionContext = decisionContext; },
    async markCompleted() {},
    async createResearchJob() { return researchJobRecord; },
    async runResearchOrchestrator(_jobId, options) {
      await options?.onProgress?.(9, 9);
      return fakeResearchContext();
    },
    async runDecisionEngine() { return fakeDecisionContext(); },
    async runAgentCoordinator(_context, options): Promise<AgentPipelineResult> {
      await options?.onProgress?.(10, 10);
      return { results: agentResults, order: Object.keys(agentResults) };
    },
    async createStrategyFromAgentResults() { return strategy; },
    async buildCampaignFromStrategy() { return campaign; },
    async getBusiness() { return opts.business ?? null; },
    async withLock(_key, _ttlMs, fn) { return fn(); },
  } as FakeDeps;
}

test("campaignGenerationPipeline - runs research -> agents -> strategy -> campaign build in order and persists results", async () => {
  const job = fakeGenerationJob();
  const deps = fakeDeps({ job });

  const progressCalls: Array<[number, number]> = [];
  const result = await runCampaignGenerationPipeline(job.id, { deps, onProgress: async (c, t) => { progressCalls.push([c, t]); } });

  assert.deepStrictEqual(result, { campaignId: "campaign-1", strategyId: "strategy-1", researchJobId: "research-1" });
  assert.deepStrictEqual(deps.statusHistory, ["researching", "aggregating", "running_agents", "building_campaign", "building_campaign"]);
  assert.ok(deps.persistedAgentResults && "campaign-agent" in deps.persistedAgentResults, "agent results must be persisted before the campaign is built");
  // 9 research units + 10 agent units + 1 build unit = 20 total; final call must reach it.
  assert.deepStrictEqual(progressCalls[progressCalls.length - 1], [20, 20]);
});

test("campaignGenerationPipeline - persists the Decision Engine's output alongside the agent results", async () => {
  const job = fakeGenerationJob();
  const deps = fakeDeps({ job });

  await runCampaignGenerationPipeline(job.id, { deps });

  assert.ok(deps.persistedDecisionContext, "decision context should have been persisted");
  assert.strictEqual(deps.persistedDecisionContext!.businessSummary, "A test business.");
});

test("campaignGenerationPipeline - a Decision Engine failure never fails campaign generation, which still completes normally", async () => {
  const job = fakeGenerationJob();
  const deps = fakeDeps({ job });
  deps.runDecisionEngine = async () => { throw new Error("decision engine exploded"); };

  const result = await runCampaignGenerationPipeline(job.id, { deps });

  assert.strictEqual(result.campaignId, "campaign-1");
  assert.strictEqual(deps.persistedDecisionContext, null, "nothing to persist when the Decision Engine failed");
});

test("campaignGenerationPipeline - uses the Budget agent's recommended daily budget when the job didn't specify one", async () => {
  const job = fakeGenerationJob({ dailyBudgetCents: undefined });
  let capturedBudget: number | undefined;
  const deps = fakeDeps({ job });
  deps.buildCampaignFromStrategy = async (_strategyId, _name, dailyBudgetCents) => {
    capturedBudget = dailyBudgetCents;
    return { id: "campaign-1", businessId: job.businessId, strategyId: "strategy-1", name: "n", status: "draft", networks: ["meta"], dailyBudgetCents, variants: [], createdAt: "now", updatedAt: "now" };
  };

  await runCampaignGenerationPipeline(job.id, { deps });

  assert.strictEqual(capturedBudget, 5000, "should fall back to BudgetAgent's recommendedDailyBudgetCents");
});

test("campaignGenerationPipeline - an explicit job.dailyBudgetCents overrides the Budget agent's recommendation", async () => {
  const job = fakeGenerationJob({ dailyBudgetCents: 12345 });
  let capturedBudget: number | undefined;
  const deps = fakeDeps({ job });
  deps.buildCampaignFromStrategy = async (_strategyId, _name, dailyBudgetCents) => {
    capturedBudget = dailyBudgetCents;
    return { id: "campaign-1", businessId: job.businessId, strategyId: "strategy-1", name: "n", status: "draft", networks: ["meta"], dailyBudgetCents, variants: [], createdAt: "now", updatedAt: "now" };
  };

  await runCampaignGenerationPipeline(job.id, { deps });

  assert.strictEqual(capturedBudget, 12345);
});

test("campaignGenerationPipeline - throws and marks the job failed if the Campaign agent produced no result", async () => {
  const job = fakeGenerationJob();
  const deps = fakeDeps({ job, agentResults: { "budget-agent": fakeBudgetAgentResult(5000) } });

  await assert.rejects(() => runCampaignGenerationPipeline(job.id, { deps }), /campaign-agent did not produce a result/);
  assert.strictEqual(deps.statusHistory.at(-1), "failed");
});

test("campaignGenerationPipeline - throws when the job cannot be loaded", async () => {
  const deps = fakeDeps({ job: fakeGenerationJob() });
  deps.loadJob = async () => null;

  await assert.rejects(() => runCampaignGenerationPipeline("missing-job", { deps }), /not found/);
});

test("campaignGenerationPipeline - acquires the lock keyed by the business id before running any phase", async () => {
  const job = fakeGenerationJob({ businessId: "biz-lock-test" });
  const deps = fakeDeps({ job });
  let capturedKey: string | undefined;
  let capturedTtl: number | undefined;
  deps.withLock = async (key, ttlMs, fn) => {
    capturedKey = key;
    capturedTtl = ttlMs;
    return fn();
  };

  await runCampaignGenerationPipeline(job.id, { deps });

  assert.strictEqual(capturedKey, "campaign-generation:biz-lock-test");
  assert.ok(capturedTtl && capturedTtl > 0);
});

test("campaignGenerationPipeline - a lock already held by a concurrent run marks the job failed and rejects, without running any phase", async () => {
  const job = fakeGenerationJob();
  const deps = fakeDeps({ job });
  let researchStarted = false;
  deps.createResearchJob = async (...args) => {
    researchStarted = true;
    return { id: "research-1", workspaceId: args[0], businessId: args[2], url: args[1], status: "pending", context: null, createdAt: "now", updatedAt: "now" };
  };
  deps.withLock = async () => {
    throw new Error("Lock already held: campaign-generation:biz-1");
  };

  await assert.rejects(() => runCampaignGenerationPipeline(job.id, { deps }), /Lock already held/);
  assert.strictEqual(deps.statusHistory.at(-1), "failed");
  assert.strictEqual(researchStarted, false, "no phase should run when the lock can't be acquired");
});
