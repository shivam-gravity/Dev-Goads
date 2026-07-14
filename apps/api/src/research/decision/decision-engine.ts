import { openai, runStructured } from "../../infra/openaiClient.js";
import { hostnameOf } from "../providers/support.js";
import { writeMemory } from "../memory/MemoryCoordinator.js";
import type { ResearchContext } from "../types/index.js";
import { generateRecommendations } from "./recommendation-engine.js";
import { rankRecommendations } from "./ranking-engine.js";
import { analyzeTradeoffs } from "./tradeoff-engine.js";
import { explainRecommendations } from "./explainability.js";
import { generateStrategies } from "./strategy-engine.js";
import { simulateStrategies } from "./simulation-engine.js";
import { enrichBusinessContext } from "./enrichment-engine.js";
import type { AudiencePersonaCard, CampaignStrategy, DecisionContext, RankedRecommendation, StrategySimulationResult, SwotAnalysis } from "./types.js";

/**
 * Decision Intelligence Engine — the top-level orchestrator that turns a ResearchContext
 * into a DecisionContext. Sits after Knowledge Fusion + Memory Coordinator in the
 * architecture (research/decision/), consumes only ResearchContext, and never touches the
 * research pipeline, Memory Coordinator, Knowledge Fusion, the AI Agent Framework, or any
 * queue/worker/infra file it reads from — everything below is read-only consumption of
 * already-computed signals plus new, additive synthesis.
 *
 * Pipeline: recommendations -> ranked -> trade-offs + explainability (parallel, both derived
 * from the same ranked set) -> strategies (grounded in top recommendations) -> simulation
 * (compares strategies) -> one narrative synthesis pass for the business-level fields.
 */

const MEMORY_KIND = "decision-recommendation";
const TOP_N_FOR_SUMMARY = 5;

const SUMMARY_TOOL = {
  name: "emit_decision_summary",
  description: "Return the narrative business-level fields of a decision context.",
  input_schema: {
    type: "object" as const,
    properties: {
      businessSummary: { type: "string", description: "2-3 sentence summary of the business and its current position" },
      recommendedPositioning: { type: "string" },
      recommendedAudiencePriority: { type: "string" },
      recommendedCreativeDirection: { type: "string" },
      recommendedOffer: { type: "string" },
      recommendedMessaging: { type: "string" },
      swot: {
        type: "object",
        description: "4-quadrant strategic read: strengths/weaknesses are about THIS business, opportunities/threats are about the market/competitive landscape around it",
        properties: {
          strengths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
          weaknesses: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
          opportunities: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
          threats: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
        },
        required: ["strengths", "weaknesses", "opportunities", "threats"],
      },
      marketGaps: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Underserved needs/segments/angles no competitor is credibly covering yet" },
      funnelStrategy: { type: "string", description: "How prospects should be moved from first awareness through to conversion/retention" },
      mediaStrategy: { type: "string", description: "Which channels/platforms to prioritize and why, given the research above" },
    },
    required: [
      "businessSummary", "recommendedPositioning", "recommendedAudiencePriority", "recommendedCreativeDirection", "recommendedOffer", "recommendedMessaging",
      "swot", "marketGaps", "funnelStrategy", "mediaStrategy",
    ],
  },
};

interface SummaryFields {
  businessSummary: string;
  recommendedPositioning: string;
  recommendedAudiencePriority: string;
  recommendedCreativeDirection: string;
  recommendedOffer: string;
  recommendedMessaging: string;
  swot: SwotAnalysis;
  marketGaps: string[];
  funnelStrategy: string;
  mediaStrategy: string;
}

function fallbackSummary(businessLabel: string): SummaryFields {
  return {
    businessSummary: `No live research was available for ${businessLabel}; this decision context is a low-confidence placeholder.`,
    recommendedPositioning: "Not yet researched",
    recommendedAudiencePriority: "Not yet researched",
    recommendedCreativeDirection: "Not yet researched",
    recommendedOffer: "Not yet researched",
    recommendedMessaging: "Not yet researched",
    swot: { strengths: ["Not yet researched"], weaknesses: ["Not yet researched"], opportunities: ["Not yet researched"], threats: ["Not yet researched"] },
    marketGaps: ["Not yet researched"],
    funnelStrategy: "Not yet researched",
    mediaStrategy: "Not yet researched",
  };
}

async function synthesizeSummary(context: ResearchContext, businessLabel: string, topRecommendations: RankedRecommendation[], winningStrategyLabel: string): Promise<SummaryFields> {
  if (!openai) return fallbackSummary(businessLabel);

  const structured = await runStructured<SummaryFields>({
    maxTokens: 1536,
    tool: SUMMARY_TOOL,
    messages: [
      {
        role: "user",
        content: `Synthesize the business-level decision summary for "${businessLabel}", including a SWOT analysis, market gaps, funnel strategy, and media strategy.\n\nCompany: ${context.company?.summary ?? "unknown"}\nMarket: ${context.market?.competitionLevel ?? "unknown"} competition, trends: ${context.market?.trends.join(", ") ?? "none"}\nCompetitor differentiators (what THIS business could own): ${context.competitors?.differentiators.join(", ") ?? "none"}\nCompetition intensity: ${context.competitors?.competitionIntensity ?? "unknown"}\nWinning strategy: ${winningStrategyLabel}\n\nTop-ranked recommendations:\n${topRecommendations.map((r) => `- [${r.category}, score ${r.finalScore}/100] ${r.title}: ${r.reason}`).join("\n")}`,
      },
    ],
  });
  return structured ?? fallbackSummary(businessLabel);
}

/** Derived directly from the audience provider's own segments/demographics/interest tags —
 * no separate LLM call, since real research data (not a fresh guess) makes for a more
 * trustworthy persona card than re-asking a model to invent one. */
function buildAudiencePersonas(context: ResearchContext): AudiencePersonaCard[] {
  const audience = context.audience;
  if (!audience || audience.segments.length === 0) return [];
  const interests = audience.interestTags.slice(0, 6);
  return audience.segments.map((segment) => ({
    name: segment.name,
    description: segment.description,
    ageRange: audience.demographics?.ageDistribution,
    genderSplit: audience.demographics?.genderRatio,
    interests,
  }));
}

function recommendedBudgetAllocation(winningPlatforms: string[]): Record<string, number> {
  if (winningPlatforms.length === 0) return {};
  const share = Math.round((1 / winningPlatforms.length) * 1000) / 1000;
  return Object.fromEntries(winningPlatforms.map((p) => [p, share]));
}

/** Deterministic reasoning chain for the hero "Recommended Daily Budget" figure, built from
 * the winning strategy's own (already-computed) confidence/simulation scores — not a fresh
 * LLM self-report, and not a new calculation, just narrating numbers that already exist. */
function buildBudgetReasoning(strategy: CampaignStrategy | undefined, simulation: StrategySimulationResult | undefined): string[] {
  if (!strategy || !simulation) {
    return ["No winning strategy was available to base a budget recommendation on."];
  }
  const dailyDollars = Math.round(strategy.budgetDailyCents / 100);
  return [
    `${strategy.label} ranked #1 of ${simulation ? "the simulated strategies" : "1 strategy"} with an overall score of ${Math.round(simulation.overallScore)}/100.`,
    `Research grounding behind this strategy is ${Math.round(strategy.confidence * 100)}% confidence.`,
    `Simulated expected ROI is ${simulation.expectedRoi}/100 against a competition level of ${simulation.competition}/100.`,
    `Budget efficiency scored ${simulation.budgetEfficiency}/100 at $${dailyDollars}/day across ${strategy.platforms.join(", ") || "the recommended channels"}.`,
  ];
}

function persistRecommendations(context: ResearchContext, ranked: RankedRecommendation[]): void {
  for (const recommendation of ranked) {
    const dedupKey = `${recommendation.category}::${recommendation.title.toLowerCase().slice(0, 80)}`;
    writeMemory({
      workspaceId: context.workspaceId,
      businessId: context.businessId,
      kind: MEMORY_KIND,
      sourceUrl: context.url,
      dedupKey,
      content: `${recommendation.category}: ${recommendation.title} — ${recommendation.reason} (score ${recommendation.finalScore}/100)`,
      metadata: { finalScore: recommendation.finalScore, priority: recommendation.priority, category: recommendation.category },
    }).catch(() => {
      // Research Memory is an enhancement (feeds future historicalSuccess scoring),
      // never a reason to fail the decision context.
    });
  }
}

export async function runDecisionEngine(context: ResearchContext): Promise<DecisionContext> {
  const businessLabel = context.company?.name ?? hostnameOf(context.url);

  const recommendations = await generateRecommendations(context);
  const ranked = await rankRecommendations(recommendations, context);
  const topRanked = ranked.slice(0, TOP_N_FOR_SUMMARY);

  const [tradeoffAnalyses, explainability, strategies, enrichment] = await Promise.all([
    analyzeTradeoffs(ranked),
    explainRecommendations(context, ranked),
    generateStrategies(context, ranked),
    enrichBusinessContext(context).catch(() => ({ pricingTiers: [], notableCustomers: [], quantifiedProofPoints: [], regionalMarketDepth: null })),
  ]);
  const simulations = simulateStrategies(strategies, context);

  const winningSimulation = simulations.find((s) => s.rank === 1) ?? simulations[0];
  const winningStrategy = strategies.find((s) => s.id === winningSimulation?.strategyId) ?? strategies[0];

  const summary = await synthesizeSummary(context, businessLabel, topRanked, winningStrategy?.label ?? "Strategy A");

  const tradeoffByRecommendationId = new Map(tradeoffAnalyses.map((t) => [t.recommendationId, t]));
  const topOpportunities = topRanked
    .filter((r) => r.impact === "high")
    .map((r) => r.expectedOutcome);
  const topRisks = topRanked
    .map((r) => tradeoffByRecommendationId.get(r.id)?.risks[0])
    .filter((risk): risk is string => Boolean(risk));

  const evidence = [...new Set(topRanked.flatMap((r) => r.evidence))];
  const tradeoffs = topRanked
    .map((r) => tradeoffByRecommendationId.get(r.id)?.expectedBusinessImpact)
    .filter((t): t is string => Boolean(t));

  const confidence = topRanked.length > 0
    ? Math.round(((topRanked.reduce((sum, r) => sum + r.finalScore, 0) / topRanked.length / 100 + (winningStrategy?.confidence ?? 0)) / 2) * 100) / 100
    : 0;

  persistRecommendations(context, ranked);

  return {
    businessSummary: summary.businessSummary,
    websiteScreenshot: context.website?.screenshot,
    audiencePersonas: buildAudiencePersonas(context),
    pricingTiers: enrichment.pricingTiers,
    notableCustomers: enrichment.notableCustomers,
    quantifiedProofPoints: enrichment.quantifiedProofPoints,
    regionalMarketDepth: enrichment.regionalMarketDepth,
    topOpportunities: topOpportunities.length > 0 ? topOpportunities : ["No high-impact opportunities identified from current research."],
    topRisks: topRisks.length > 0 ? topRisks : ["No specific risks identified from current research."],
    recommendedPositioning: summary.recommendedPositioning,
    recommendedAudiencePriority: summary.recommendedAudiencePriority,
    recommendedChannels: winningStrategy?.platforms ?? [],
    recommendedBudgetAllocation: recommendedBudgetAllocation(winningStrategy?.platforms ?? []),
    recommendedDailyBudgetCents: winningStrategy?.budgetDailyCents ?? 0,
    budgetReasoning: buildBudgetReasoning(winningStrategy, winningSimulation),
    recommendedCreativeDirection: summary.recommendedCreativeDirection,
    recommendedOffer: summary.recommendedOffer,
    recommendedMessaging: summary.recommendedMessaging,
    swot: summary.swot,
    marketGaps: summary.marketGaps,
    funnelStrategy: summary.funnelStrategy,
    mediaStrategy: summary.mediaStrategy,
    confidence,
    evidence,
    tradeoffs,
    recommendations: ranked,
    tradeoffAnalyses,
    explainability,
    strategies,
    simulations,
    generatedAt: new Date().toISOString(),
  };
}
