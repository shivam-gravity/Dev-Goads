import { test } from "node:test";
import assert from "node:assert";
import { runCampaignGenerationPipeline, type CampaignGenerationDeps } from "../modules/orchestrator/campaignGenerationPipeline.js";
import { LockWaitTimeoutError } from "../infra/distributedLock.js";
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
    recommendedMessaging: "n/a",
    swot: { strengths: [], weaknesses: [], opportunities: [], threats: [] }, marketGaps: [], funnelStrategy: "n/a", mediaStrategy: "n/a",
    confidence: 0.5, evidence: [], tradeoffs: [],
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
    async extractCrawlFacts() { return 0; },
    async buildCompanyProfile() { return null; },
    async runDecisionEngine() { return fakeDecisionContext(); },
    async runIntelligenceEnrichment() { return { landingPage: null }; },
    async generateCampaignRecommendations() { return 0; },
    async runAgentCoordinator(_context, options): Promise<AgentPipelineResult> {
      await options?.onProgress?.(10, 10);
      return { results: agentResults, order: Object.keys(agentResults) };
    },
    async createStrategyFromAgentResults() { return strategy; },
    async buildCampaignFromStrategy() { return campaign; },
    async getBusiness() { return opts.business ?? null; },
    async withLock(_key, _ttlMs, _maxWaitMs, fn) { return fn(); },
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
  // 27 research units + 20 agent units + 1 build unit = 48 total; final call must reach it.
  assert.deepStrictEqual(progressCalls[progressCalls.length - 1], [48, 48]);
});

test("campaignGenerationPipeline - passes pricing-offer/objection-handling/compliance agent results through to createStrategyFromAgentResults as extras", async () => {
  const job = fakeGenerationJob();
  const deps = fakeDeps({
    job,
    agentResults: {
      "campaign-agent": fakeCampaignAgentResult(),
      "budget-agent": fakeBudgetAgentResult(5000),
      "pricing-offer-agent": {
        agent: "pricing-offer-agent", promptId: "pricing-offer-agent", promptVersion: 2,
        data: { recommendedOfferType: "Free trial", pricingPositioning: "n/a", guaranteeOrRiskReversal: "n/a", urgencyAngle: "n/a" },
        confidence: 0.8, evidence: [], usedFallback: false, generatedAt: "now", durationMs: 1,
      },
      "objection-handling-agent": {
        agent: "objection-handling-agent", promptId: "objection-handling-agent", promptVersion: 2,
        data: { topObjections: ["Too expensive?"], rebuttalAngles: ["Cheaper than the leader."], trustSignalsToHighlight: [] },
        confidence: 0.8, evidence: [], usedFallback: false, generatedAt: "now", durationMs: 1,
      },
      "compliance-agent": {
        agent: "compliance-agent", promptId: "compliance-agent", promptVersion: 1,
        data: { overallRisk: "medium", flags: [], restrictedCategoryConcerns: [], recommendation: "Review before launch." },
        confidence: 0.8, evidence: [], usedFallback: false, generatedAt: "now", durationMs: 1,
      },
    },
  });

  let capturedExtras: unknown;
  deps.createStrategyFromAgentResults = async (businessId, output, decisionContext, extras) => {
    capturedExtras = extras;
    return {
      id: "strategy-1", businessId, summary: "s", recommendedNetworks: ["meta"], budgetSplit: { meta: 1 },
      audiences: ["Everyone"], creatives: [{ headline: "Hi", body: "Body", callToAction: "Go" }], createdAt: "now",
    };
  };

  await runCampaignGenerationPipeline(job.id, { deps });

  assert.deepStrictEqual(capturedExtras, {
    pricingOffer: { recommendedOfferType: "Free trial", pricingPositioning: "n/a", guaranteeOrRiskReversal: "n/a", urgencyAngle: "n/a" },
    objectionHandling: { topObjections: ["Too expensive?"], rebuttalAngles: ["Cheaper than the leader."], trustSignalsToHighlight: [] },
    compliance: { overallRisk: "medium", flags: [], restrictedCategoryConcerns: [], recommendation: "Review before launch." },
  });
});

test("campaignGenerationPipeline - builds successfully when pricing-offer/objection-handling/compliance agents didn't run at all (extras are undefined, not thrown)", async () => {
  const job = fakeGenerationJob();
  const deps = fakeDeps({ job }); // only campaign-agent + budget-agent, like every pre-existing test in this file

  let capturedExtras: unknown;
  deps.createStrategyFromAgentResults = async (businessId, output, decisionContext, extras) => {
    capturedExtras = extras;
    return {
      id: "strategy-1", businessId, summary: "s", recommendedNetworks: ["meta"], budgetSplit: { meta: 1 },
      audiences: ["Everyone"], creatives: [{ headline: "Hi", body: "Body", callToAction: "Go" }], createdAt: "now",
    };
  };

  const result = await runCampaignGenerationPipeline(job.id, { deps });
  assert.strictEqual(result.campaignId, "campaign-1");
  assert.deepStrictEqual(capturedExtras, { pricingOffer: undefined, objectionHandling: undefined, compliance: undefined });
});

test("campaignGenerationPipeline - extracts crawl facts after research but BEFORE the agents run when the crawl was persisted, and skips extraction without a crawlJobId", async () => {
  const job = fakeGenerationJob();
  const calls: string[] = [];

  // With a crawlJobId on the research context: extraction runs, and strictly before agents.
  const deps = fakeDeps({ job });
  deps.runResearchOrchestrator = async () => ({
    ...fakeResearchContext(),
    website: { title: "t", description: "d", excerpt: "e", images: [], crawledPages: [], pagesDiscovered: 1, dataSource: "crawl", crawlJobId: "crawl-1" },
  });
  deps.extractCrawlFacts = async (crawlJobId) => { calls.push(`extract:${crawlJobId}`); return 3; };
  const innerRunAgents = deps.runAgentCoordinator;
  deps.runAgentCoordinator = async (context, options) => { calls.push("agents"); return innerRunAgents(context, options); };

  await runCampaignGenerationPipeline(job.id, { deps });
  assert.deepStrictEqual(calls, ["extract:crawl-1", "agents"], "facts must be in the DB before agents start reading them");

  // Without a crawlJobId (default fake context): extraction must not be called at all.
  const noCrawlDeps = fakeDeps({ job });
  let extractCalled = false;
  noCrawlDeps.extractCrawlFacts = async () => { extractCalled = true; return 0; };
  await runCampaignGenerationPipeline(job.id, { deps: noCrawlDeps });
  assert.strictEqual(extractCalled, false, "no crawl persistence means nothing to extract from");
});

test("campaignGenerationPipeline - a fact-extraction failure never fails campaign generation", async () => {
  const job = fakeGenerationJob();
  const deps = fakeDeps({ job });
  deps.runResearchOrchestrator = async () => ({
    ...fakeResearchContext(),
    website: { title: "t", description: "d", excerpt: "e", images: [], crawledPages: [], pagesDiscovered: 1, dataSource: "crawl", crawlJobId: "crawl-1" },
  });
  deps.extractCrawlFacts = async () => { throw new Error("extraction exploded"); };

  const result = await runCampaignGenerationPipeline(job.id, { deps });
  assert.strictEqual(result.campaignId, "campaign-1", "pipeline must complete despite the extraction failure");
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
  let capturedMaxWaitMs: number | undefined;
  deps.withLock = async (key, ttlMs, maxWaitMs, fn) => {
    capturedKey = key;
    capturedTtl = ttlMs;
    capturedMaxWaitMs = maxWaitMs;
    return fn();
  };

  await runCampaignGenerationPipeline(job.id, { deps });

  assert.strictEqual(capturedKey, "campaign-generation:biz-lock-test");
  assert.ok(capturedTtl && capturedTtl > 0);
  assert.ok(capturedMaxWaitMs && capturedMaxWaitMs > 0);
});

test("campaignGenerationPipeline - a lock wait that times out marks the job failed and rejects, without running any phase", async () => {
  const job = fakeGenerationJob();
  const deps = fakeDeps({ job });
  let researchStarted = false;
  deps.createResearchJob = async (...args) => {
    researchStarted = true;
    return { id: "research-1", workspaceId: args[0], businessId: args[2], url: args[1], status: "pending", context: null, createdAt: "now", updatedAt: "now" };
  };
  deps.withLock = async (key, _ttlMs, maxWaitMs) => {
    throw new LockWaitTimeoutError(key, maxWaitMs);
  };

  await assert.rejects(() => runCampaignGenerationPipeline(job.id, { deps }), /Timed out.*waiting for lock/);
  assert.strictEqual(deps.statusHistory.at(-1), "failed");
  assert.strictEqual(researchStarted, false, "no phase should run when the lock wait times out");
});

test("campaignGenerationPipeline - proceeds successfully even when the lock needed several internal poll attempts to acquire", async () => {
  const job = fakeGenerationJob();
  const deps = fakeDeps({ job });
  let simulatedPollAttempts = 0;
  deps.withLock = async (_key, _ttlMs, _maxWaitMs, fn) => {
    // Stands in for withQueuedLock's real poll loop (covered directly, against real Redis,
    // in distributedLock.test.ts) having to retry a few times before acquiring — from the
    // pipeline's perspective, a lock that took several polls to acquire must be
    // indistinguishable from one acquired immediately: fn() still runs, still succeeds.
    simulatedPollAttempts = 3;
    return fn();
  };

  const result = await runCampaignGenerationPipeline(job.id, { deps });

  assert.deepStrictEqual(result, { campaignId: "campaign-1", strategyId: "strategy-1", researchJobId: "research-1" });
  assert.strictEqual(simulatedPollAttempts, 3);
});
