import type { Citation } from "../../types/index.js";
import type { ResearchContext } from "../types/index.js";

/**
 * The Decision Intelligence Engine's type surface. Sits downstream of the research
 * pipeline (ResearchOrchestrator -> Knowledge Fusion -> Memory Coordinator, none of which
 * this layer modifies) and turns a ResearchContext into a DecisionContext: not more
 * research, but a ranked, explainable, trade-off-aware set of decisions a marketer can
 * act on. Every type here is new/additive — nothing in research/types or research/knowledge
 * changes shape to support this.
 */

export type RecommendationCategory =
  | "positioning"
  | "audience"
  | "channel"
  | "budget"
  | "creative"
  | "offer"
  | "messaging";

export type Priority = "low" | "medium" | "high" | "critical";
export type ImpactLevel = "low" | "medium" | "high";
export type DifficultyLevel = "low" | "medium" | "high";
export type Platform = "meta" | "google" | "tiktok" | "linkedin" | "other";

/** One actionable, evidence-backed suggestion — the atomic unit the rest of the engine
 * ranks, explains, and assembles into strategies. */
export interface Recommendation {
  id: string;
  title: string;
  category: RecommendationCategory;
  priority: Priority;
  impact: ImpactLevel;
  /** 0-1, deterministically derived from which ResearchContext fields backed this
   * recommendation and their fused confidence — never an LLM self-report (see
   * recommendation-engine.ts's computeRecommendationConfidence). */
  confidence: number;
  reason: string;
  evidence: string[];
  affectedAudience: string;
  estimatedDifficulty: DifficultyLevel;
  expectedOutcome: string;
}

/** The 7 weighted inputs the Ranking Engine blends into one Final Recommendation Score.
 * Each is normalized to 0-1 before weighting. */
export interface RankingFactors {
  researchConfidence: number;
  evidenceQuality: number;
  sourceAuthority: number;
  freshness: number;
  businessRelevance: number;
  crossProviderAgreement: number;
  historicalSuccess: number;
}

export type RankingWeights = RankingFactors;

export interface RankedRecommendation extends Recommendation {
  rankingFactors: RankingFactors;
  /** 0-100 — the weighted blend of rankingFactors, the number recommendations are sorted
   * by everywhere in this engine. */
  finalScore: number;
}

export interface TradeoffAnalysis {
  recommendationId: string;
  benefits: string[];
  risks: string[];
  alternatives: string[];
  expectedBusinessImpact: string;
  implementationComplexity: DifficultyLevel;
}

export interface MemoryReference {
  kind: string;
  sourceUrl: string;
  snippet: string;
  similarity: number;
}

/** Full traceability for one recommendation — every field here answers "why should I
 * believe this," never a new judgment call of its own. */
export interface ExplainabilityReport {
  recommendationId: string;
  evidence: string[];
  supportingProviders: string[];
  memoryReferences: MemoryReference[];
  conflictingInformation: string[];
  confidenceBreakdown: RankingFactors;
  freshness: number;
  sourceAuthority: number;
}

export interface CampaignStrategy {
  id: string;
  label: string;
  targetAudience: string;
  platforms: Platform[];
  objective: string;
  budgetDailyCents: number;
  creativeDirection: string;
  messaging: string;
  offer: string;
  expectedKpi: string;
  strengths: string[];
  weaknesses: string[];
  /** 0-1, deterministic blend of overall research confidence + the ranking scores of the
   * recommendations this strategy was built from — see strategy-engine.ts. */
  confidence: number;
}

export interface StrategySimulationResult {
  strategyId: string;
  strategyLabel: string;
  reach: number;
  competition: number;
  expectedRoi: number;
  risk: number;
  confidence: number;
  budgetEfficiency: number;
  /** 0-100 weighted blend of the above — strategies are ranked by this. */
  overallScore: number;
  rank: number;
}

export interface AudiencePersonaCard {
  name: string;
  description: string;
  ageRange?: string;
  genderSplit?: string;
  interests: string[];
}

export interface PricingTier {
  tier: string;
  priceRange: string;
  details: string;
}

export interface RegionalMarketDepth {
  region: string;
  marketSize?: string;
  growthRate?: string;
  policyDrivers: string[];
}

/** Output of enrichment-engine.ts — closes 4 content gaps none of the 9 core research
 * providers capture (pricing, named customers, quantified claims, country-level market
 * depth), via its own targeted live web search rather than modifying those providers. */
export interface EnrichmentData {
  pricingTiers: PricingTier[];
  notableCustomers: string[];
  quantifiedProofPoints: string[];
  regionalMarketDepth: RegionalMarketDepth | null;
}

/** Strengths/weaknesses are about THIS business; opportunities/threats are about the
 * market/competitive landscape around it — the standard 4-quadrant framing, synthesized
 * from the same ranked recommendations + market/competitor signals every other narrative
 * field in DecisionContext already draws from (see decision-engine.ts's synthesizeSummary). */
export interface SwotAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
}

export interface DecisionContext {
  businessSummary: string;
  /** Above-the-fold screenshot of the analyzed page, when the scraper-service was reachable
   * (WebsiteProvider/WebsiteData.screenshot, passed through unchanged) — undefined otherwise. */
  websiteScreenshot?: string;
  /** Derived directly from ResearchContext.audience.segments/demographics/interestTags — no
   * separate LLM call, since that data is already real research output. Empty array when
   * the audience provider didn't return usable segments. */
  audiencePersonas: AudiencePersonaCard[];
  pricingTiers: PricingTier[];
  notableCustomers: string[];
  quantifiedProofPoints: string[];
  regionalMarketDepth: RegionalMarketDepth | null;
  topOpportunities: string[];
  topRisks: string[];
  recommendedPositioning: string;
  recommendedAudiencePriority: string;
  recommendedChannels: string[];
  /** Platform -> share of budget, fractions summing to ~1. */
  recommendedBudgetAllocation: Record<string, number>;
  /** The winning (rank 1) simulated strategy's daily budget, surfaced as one hero number —
   * previously only visible buried inside strategies[].budgetDailyCents. */
  recommendedDailyBudgetCents: number;
  /** Deterministic reasoning chain for recommendedDailyBudgetCents, built from the winning
   * strategy's own confidence/ROI/budget-efficiency simulation scores — not a fresh LLM
   * self-report, same principle as every other score in this engine. */
  budgetReasoning: string[];
  recommendedCreativeDirection: string;
  recommendedOffer: string;
  recommendedMessaging: string;
  /** The 4-quadrant strategic read on this business relative to its market/competitors. */
  swot: SwotAnalysis;
  /** Underserved needs/segments/angles no competitor is credibly covering yet. */
  marketGaps: string[];
  /** How prospects should be moved from first awareness through to conversion/retention. */
  funnelStrategy: string;
  /** Which channels/platforms to prioritize and why, given the research above. */
  mediaStrategy: string;
  /** 0-1 overall confidence in this DecisionContext. */
  confidence: number;
  evidence: string[];
  tradeoffs: string[];
  recommendations: RankedRecommendation[];
  tradeoffAnalyses: TradeoffAnalysis[];
  explainability: ExplainabilityReport[];
  strategies: CampaignStrategy[];
  simulations: StrategySimulationResult[];
  generatedAt: string;
}

/** Shared context every sub-engine gets threaded through it — avoids each engine
 * re-deriving the same provider-availability/citation bookkeeping from ResearchContext. */
export interface DecisionInput {
  context: ResearchContext;
  businessLabel: string;
}

export type { Citation };
