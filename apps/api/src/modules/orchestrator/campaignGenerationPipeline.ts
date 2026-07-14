import { logger } from "../logger/logger.js";
import type { AgentCoordinatorOptions, AgentPipelineResult } from "../../agents/AgentCoordinator.js";
import { runAgentCoordinator } from "../../agents/AgentCoordinator.js";
import type { AgentResult, BudgetAgentOutput, CampaignAgentOutput, ComplianceAgentOutput, ObjectionHandlingAgentOutput, PricingOfferAgentOutput } from "../../agents/types/index.js";
import type { ResearchContext } from "../../research/types/index.js";
import { createResearchJob, runResearchOrchestrator, type RunResearchOrchestratorOptions } from "../../research/research-orchestrator/index.js";
import { extractAndPersistCrawlFacts } from "../../research/crawl/factExtraction.js";
import { buildAndPersistCompanyProfile } from "../../research/company-knowledge/CompanyKnowledgeBuilder.js";
import { runDecisionEngine } from "../../research/decision/decision-engine.js";
import type { DecisionContext } from "../../research/decision/types.js";
import { runIntelligenceEnrichment, type IntelligenceEnrichmentResult } from "../../research/intelligenceEnrichment.js";
import { generateAndPersistCampaignRecommendations } from "../../research/campaign-recommendation/CampaignRecommendationEngine.js";
import { createStrategyFromAgentResults } from "../strategy/strategyEngine.js";
import { buildCampaignFromStrategy } from "./campaignOrchestrator.js";
import { getBusiness } from "../business/businessService.js";
import { recordRecommendationDecisions } from "../../research/decision/campaign-intelligence-store.js";
import { withQueuedLock } from "../../infra/distributedLock.js";
import { withSpan } from "../../infra/telemetry.js";
import {
  getCampaignGenerationJob,
  markCampaignGenerationCompleted,
  markCampaignGenerationStatus,
  persistAgentResults,
  persistDecisionContext,
  type CampaignGenerationJobRecord,
  type CampaignGenerationStatus,
} from "./campaignGenerationService.js";

/** Persistence hooks the pipeline calls out to — real implementations (defaultDeps
 * below) hit Postgres/the real orchestrators; unit tests inject in-memory fakes instead,
 * mirroring OrchestratorDeps in research/research-orchestrator/ResearchOrchestrator.ts. */
export interface CampaignGenerationDeps {
  loadJob: typeof getCampaignGenerationJob;
  markStatus: typeof markCampaignGenerationStatus;
  persistAgentResults: typeof persistAgentResults;
  persistDecisionContext: typeof persistDecisionContext;
  markCompleted: typeof markCampaignGenerationCompleted;
  createResearchJob: typeof createResearchJob;
  runResearchOrchestrator: typeof runResearchOrchestrator;
  extractCrawlFacts: typeof extractAndPersistCrawlFacts;
  buildCompanyProfile: typeof buildAndPersistCompanyProfile;
  runDecisionEngine: typeof runDecisionEngine;
  runIntelligenceEnrichment: typeof runIntelligenceEnrichment;
  generateCampaignRecommendations: typeof generateAndPersistCampaignRecommendations;
  runAgentCoordinator: typeof runAgentCoordinator;
  createStrategyFromAgentResults: typeof createStrategyFromAgentResults;
  buildCampaignFromStrategy: typeof buildCampaignFromStrategy;
  getBusiness: typeof getBusiness;
  withLock: typeof withQueuedLock;
}

export const defaultCampaignGenerationDeps: CampaignGenerationDeps = {
  loadJob: getCampaignGenerationJob,
  markStatus: markCampaignGenerationStatus,
  persistAgentResults,
  persistDecisionContext,
  markCompleted: markCampaignGenerationCompleted,
  createResearchJob,
  runResearchOrchestrator,
  extractCrawlFacts: extractAndPersistCrawlFacts,
  buildCompanyProfile: buildAndPersistCompanyProfile,
  runDecisionEngine,
  runIntelligenceEnrichment,
  generateCampaignRecommendations: generateAndPersistCampaignRecommendations,
  runAgentCoordinator,
  createStrategyFromAgentResults,
  buildCampaignFromStrategy,
  getBusiness,
  withLock: withQueuedLock,
};

// Generous relative to the ~1 minute a full research+agents+build run has taken in live
// verification, so a slow-but-healthy run is never preempted by its own lock expiring —
// the cost of erring long here is a genuinely-crashed job leaving the lock stuck for up
// to this long, which is an acceptable trade since a stuck lock only blocks re-running
// the SAME business, not the whole pipeline.
const CAMPAIGN_GENERATION_LOCK_TTL_MS = 10 * 60 * 1000;

export interface RunCampaignGenerationOptions {
  deps?: CampaignGenerationDeps;
  /** Called with (completed, total, stepName) across the WHOLE pipeline (research providers +
   * agents + the campaign-build step) on one consistent 0..total scale, so a single
   * BullMQ job.updateProgress call can represent the entire Gateway -> Campaign Route ->
   * Research Orchestrator -> Knowledge Aggregator -> AI Agent Coordinator -> Campaign
   * Builder flow, not just one stage of it. `stepName` is the provider/agent that just
   * settled (or a phase-boundary marker like "aggregating"/"campaign-built") — callers use
   * it to show real live progress instead of a bare percentage. */
  onProgress?: (completed: number, total: number, stepName?: string) => void | Promise<void>;
}

// Fixed fan-out widths of the two sub-pipelines this orchestrates — see
// research/providers/index.ts (27 providers) and agents/agents/index.ts (20 agents) —
// plus one unit for the campaign-build step, so progress is one meaningful number
// across all three phases rather than three separately-scaled ones.
const RESEARCH_PROVIDER_COUNT = 27;
const AGENT_COUNT = 20;
// Exported so the gateway's progress route (router.ts) can report a total alongside the
// live step list without duplicating this arithmetic.
export const TOTAL_PIPELINE_UNITS = RESEARCH_PROVIDER_COUNT + AGENT_COUNT + 1;

function defaultCampaignName(job: CampaignGenerationJobRecord, business: { name: string; brandName?: string } | null): string {
  return job.name ?? business?.brandName ?? business?.name ?? `AI-generated campaign for ${job.url}`;
}

/**
 * The full agent-pipeline's core entrypoint — called by the BullMQ worker (see
 * workers/campaignGenerationWorker.ts) with just a jobId, exactly like
 * runResearchOrchestrator. Sequences, in order: Research Orchestrator (which runs its
 * own 27 providers + Knowledge Aggregator internally), the AI Agent Coordinator (20
 * agents), then the Campaign Builder (AdStrategy -> Campaign via the existing,
 * unmodified buildCampaignFromStrategy). No agent, provider, or prompt is touched here —
 * this file only sequences already-built, independently-tested pieces.
 */
export async function runCampaignGenerationPipeline(
  jobId: string,
  options: RunCampaignGenerationOptions = {}
): Promise<{ campaignId: string; strategyId: string; researchJobId: string }> {
  const deps = options.deps ?? defaultCampaignGenerationDeps;

  const job = await deps.loadJob(jobId);
  if (!job) throw new Error(`Campaign generation job ${jobId} not found`);

  let completedUnits = 0;
  const reportOverall = async (stepName?: string) => {
    await options.onProgress?.(completedUnits, TOTAL_PIPELINE_UNITS, stepName);
  };

  const markStatus = async (status: CampaignGenerationStatus, extra?: Parameters<typeof markCampaignGenerationStatus>[2]) => {
    await deps.markStatus(jobId, status, extra);
  };

  try {
    return await deps.withLock(`campaign-generation:${job.businessId}`, CAMPAIGN_GENERATION_LOCK_TTL_MS, CAMPAIGN_GENERATION_LOCK_TTL_MS, () => runPhases(job));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Campaign generation failed";
    await deps
      .markStatus(jobId, "failed", { completedAt: true, error: message })
      .catch((persistErr) => logger.error(`Failed to persist failure for campaign generation job ${jobId}`, persistErr));
    throw err;
  }

  // ── Phases 1-3, run only while campaign-generation:${job.businessId} is held — a
  // second concurrent generate request for the same business rejects immediately (via
  // deps.withLock throwing LockAlreadyHeldError) instead of racing this one. `job` is
  // passed explicitly (not closed over) so TypeScript's null-narrowing above still
  // applies inside this nested function. ──
  async function runPhases(job: CampaignGenerationJobRecord): Promise<{ campaignId: string; strategyId: string; researchJobId: string }> {
    // ── Phase 1: Research Orchestrator -> Knowledge Aggregator ──
    const researchJob = await deps.createResearchJob(job.workspaceId, job.url, job.businessId);
    await markStatus("researching", { startedAt: true, researchJobId: researchJob.id });

    const context: ResearchContext = await withSpan("campaign_generation.research", () =>
      deps.runResearchOrchestrator(researchJob.id, {
        onProgress: async (completed, _total, providerName) => {
          completedUnits = completed;
          await reportOverall(providerName);
        },
      })
    );
    completedUnits = RESEARCH_PROVIDER_COUNT;
    await markStatus("aggregating");
    await reportOverall("aggregating");

    // Fact extraction must finish BEFORE the agents run (unlike the Decision Engine below,
    // which is concurrent) — the fact-grounded agents (creative/campaign/critic) read
    // CrawlFact rows from the DB at execute time, so facts written after they start are
    // invisible to them. Still best-effort: no crawl persistence or an extraction failure
    // just means agents run un-grounded, exactly as they did before this step existed.
    const crawlJobId = context.website?.crawlJobId;
    if (crawlJobId) {
      await withSpan("campaign_generation.fact_extraction", () => deps.extractCrawlFacts(crawlJobId))
        .then((count) => logger.info(`Extracted ${count} crawl facts for campaign generation job ${jobId}`))
        .catch((err) => logger.warn(`Crawl fact extraction failed for campaign generation job ${jobId} — agents run without verified facts`, err));
    }

    // Company Knowledge Builder — pure assembly from the ResearchContext/CrawlFact rows
    // already produced above, no new external calls, so it's cheap enough to await inline
    // rather than run fire-and-forget. Best-effort: never fails campaign generation (the
    // function itself never throws, but this stays defensive in case that contract changes).
    await withSpan("campaign_generation.company_knowledge", () => deps.buildCompanyProfile(context)).catch((err) => {
      logger.warn(`Company Knowledge Builder failed for campaign generation job ${jobId} — continuing without a persisted CompanyProfile`, err);
    });

    // Decision Engine runs concurrently with the Agent Coordinator below (same input,
    // ResearchContext, independent output) so it adds no extra latency to the pipeline.
    // Best-effort: a Decision Engine failure never fails campaign generation, which already
    // works reliably off the Agent Coordinator — same "enhancement, not hard dependency"
    // principle as every Research Memory write elsewhere in this codebase.
    const decisionContextPromise = withSpan("campaign_generation.decision", () => deps.runDecisionEngine(context)).catch((err) => {
      logger.warn(`Decision Engine failed for campaign generation job ${jobId} — continuing without it`, err);
      return null;
    });

    // Not awaited alongside the rest of Phase 1/2 (same "enhancement, not hard dependency"
    // posture as the Decision Engine above) — but unlike before, the promise itself IS kept
    // (not discarded), since its landingPage result feeds the Campaign Recommendation Engine
    // in Phase 3 below. By the time Phase 3 needs it, the real agent calls in Phase 2 have
    // almost always already given this promise enough time to settle; awaiting it there adds
    // no meaningful latency in the common case.
    const intelligenceEnrichmentPromise = withSpan("campaign_generation.intelligence_enrichment", () => deps.runIntelligenceEnrichment(context)).catch(
      (err): IntelligenceEnrichmentResult => {
        logger.warn(`Intelligence enrichment failed for campaign generation job ${jobId} — continuing without it`, err);
        return { landingPage: null };
      }
    );

    // ── Phase 2: AI Agent Coordinator ──
    await markStatus("running_agents");
    const pipeline: AgentPipelineResult = await withSpan("campaign_generation.agents", () =>
      deps.runAgentCoordinator(context, {
        onProgress: async (completed, _total, agentName) => {
          completedUnits = RESEARCH_PROVIDER_COUNT + completed;
          await reportOverall(agentName);
        },
      } satisfies AgentCoordinatorOptions)
    );
    await deps.persistAgentResults(jobId, pipeline.results);

    // Persist as soon as it's ready (usually well before this point, since it runs
    // concurrently with the agents above) so a polling client sees the Decision Engine's
    // rich, ranked/explainable output without waiting for the campaign build to finish too.
    const decisionContext: DecisionContext | null = await decisionContextPromise;
    if (decisionContext) await deps.persistDecisionContext(jobId, decisionContext);

    const campaignAgentResult = pipeline.results["campaign-agent"] as AgentResult<CampaignAgentOutput> | undefined;
    if (!campaignAgentResult) throw new Error("campaign-agent did not produce a result — cannot build a campaign");

    // These three previously ran alongside the other 17 agents, got persisted via
    // persistAgentResults above, and were never read again — folding their output into the
    // strategy (extra creatives, a compliance warning) is what actually puts them to work.
    const pricingOfferResult = pipeline.results["pricing-offer-agent"] as AgentResult<PricingOfferAgentOutput> | undefined;
    const objectionHandlingResult = pipeline.results["objection-handling-agent"] as AgentResult<ObjectionHandlingAgentOutput> | undefined;
    const complianceResult = pipeline.results["compliance-agent"] as AgentResult<ComplianceAgentOutput> | undefined;

    // ── Phase 3: Campaign Builder ──
    await markStatus("building_campaign");
    const { campaign, strategyId } = await withSpan("campaign_generation.build", async () => {
      const business = await deps.getBusiness(job.businessId);
      const strategy = await deps.createStrategyFromAgentResults(job.businessId, campaignAgentResult.data, decisionContext, {
        pricingOffer: pricingOfferResult?.data,
        objectionHandling: objectionHandlingResult?.data,
        compliance: complianceResult?.data,
      });
      await markStatus("building_campaign", { strategyId: strategy.id });

      const budgetAgentResult = pipeline.results["budget-agent"] as AgentResult<BudgetAgentOutput> | undefined;
      const dailyBudgetCents = job.dailyBudgetCents ?? budgetAgentResult?.data.recommendedDailyBudgetCents ?? 2000;
      const name = defaultCampaignName(job, business);

      const campaign = await deps.buildCampaignFromStrategy(strategy.id, name, dailyBudgetCents);
      return { campaign, strategyId: strategy.id };
    });

    // Campaign Recommendation Engine — additive alongside the single Campaign just built
    // above (never replacing it). Best-effort: the function itself never throws, but this
    // stays defensive in case that contract changes.
    const { landingPage } = await intelligenceEnrichmentPromise;
    const landingPageRecommendation = landingPage?.recommendations[0] ?? "No landing-page-specific recommendation available.";
    await withSpan("campaign_generation.campaign_recommendations", () =>
      deps.generateCampaignRecommendations(jobId, decisionContext, campaignAgentResult.data.creatives, landingPageRecommendation)
    ).catch((err) => {
      logger.warn(`Campaign Recommendation Engine failed for campaign generation job ${jobId} — continuing without persisted recommendations`, err);
    });

    completedUnits = TOTAL_PIPELINE_UNITS;
    await reportOverall("campaign-built");
    await deps.markCompleted(jobId, campaign.id);

    // Campaign Intelligence: records which of the Decision Engine's ranked recommendations
    // actually fed this campaign vs. which were ranked but not used — best-effort, same
    // "enhancement, not hard dependency" posture as the Decision Engine call itself above.
    if (decisionContext) {
      await recordRecommendationDecisions({
        workspaceId: job.workspaceId,
        businessId: job.businessId,
        campaignId: campaign.id,
        decisionContext,
      }).catch((err) => {
        logger.warn(`recordRecommendationDecisions failed for campaign generation job ${jobId} — continuing`, err);
      });
    }

    return { campaignId: campaign.id, strategyId, researchJobId: researchJob.id };
  }
}
