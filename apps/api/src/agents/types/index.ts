import type { ResearchContext } from "../../research/types/index.js";
import type { LLMProvider } from "../../infra/llmRouter.js";

/**
 * The AI Agent Framework's own type surface — an AI reasoning layer built ON TOP of the
 * Research Orchestrator (apps/api/src/research), never modifying it. Every agent here
 * consumes an already-aggregated ResearchContext; none of them fetch data themselves
 * (that's the 9 research providers' job) — this layer is pure reasoning over what the
 * orchestrator already gathered, which keeps it fast, cheap, and cleanly separated.
 */

export type { ResearchContext };

/** One traceable provenance entry — which ResearchContext field an agent drew from, and
 * that field's own dataSource label. Deliberately derived from the context itself (never
 * from what the model claims it used), so evidence can't be hallucinated. */
export interface AgentEvidenceItem {
  source: string;
  detail: string;
}

/** The uniform envelope every agent returns. `confidence` is a deterministic 0-1 score
 * (see support.ts's computeConfidence) based on how much of the input data the agent
 * actually had available and validated — not a self-reported LLM confidence, which is
 * well known to be unreliable/uncalibrated. `promptVersion` records exactly which
 * registered prompt version produced this result, so a result is always reproducible
 * against the exact prompt that generated it. */
export interface AgentResult<T> {
  agent: string;
  promptId: string;
  promptVersion: number;
  data: T;
  confidence: number;
  evidence: AgentEvidenceItem[];
  usedFallback: boolean;
  generatedAt: string;
  durationMs: number;
  error?: string;
  /** Which LLM provider actually produced `data` — including when an assigned
   * non-OpenAI provider failed and llmRouter.ts fell back to OpenAI. Absent for agents
   * whose data came entirely from a non-LLM fallback rather than any model call. Lets a
   * task reassignment's real-world quality be inspected without log-spelunking. */
  modelSource?: LLMProvider;
}

/** Extra input beyond ResearchContext that only CriticAgent uses (it reviews the other
 * agents' proposed outputs) — every other agent ignores this parameter entirely. Kept as
 * one optional field on the shared interface rather than a special-cased second
 * interface, so all 10 agents remain interchangeable/independently testable through the
 * exact same AIAgent<T> contract. */
export interface AgentExecuteInput {
  priorResults?: Record<string, AgentResult<unknown>>;
}

/* ─────────────────────────────  Per-agent output shapes  ───────────────────────────── */

export interface ProductAgentOutput {
  productName: string;
  category: string;
  summary: string;
  valueProposition: string;
  keyFeatures: string[];
}

export interface AudienceSegmentInsight {
  name: string;
  description: string;
}

export interface AudienceAgentOutput {
  primaryAudience: string;
  segments: AudienceSegmentInsight[];
  painPoints: string[];
  interestTags: string[];
  targetingNotes: string;
}

export interface CompetitorAgentOutput {
  competitors: string[];
  competitiveAdvantages: string[];
  threats: string[];
  positioningRecommendation: string;
}

export interface MarketAgentOutput {
  opportunityScore: number;
  marketSummary: string;
  risks: string[];
  recommendedRegion: string;
}

export interface KeywordAgentOutput {
  primaryKeywords: string[];
  adGroupSuggestions: string[];
  negativeKeywords: string[];
}

export interface CreativeAgentOutput {
  headlines: string[];
  primaryTexts: string[];
  callToAction: string;
  creativeAngles: string[];
}

export interface BudgetAgentOutput {
  recommendedDailyBudgetCents: number;
  testBudgetCents?: number;
  scaleBudgetCents?: number;
  platformSplit?: { meta: number; google: number; tiktok?: number };
  reasoning: string[];
  expectedOutcomes?: {
    dailyClicks?: number;
    dailyImpressions?: number;
    estimatedCPACents?: number;
    estimatedROAS?: number;
    monthlyConversions?: number;
  };
  riskFactors: string[];
}

export interface PersonaAgentPersona {
  name: string;
  ageRange: string;
  genderSplit: string;
  details: string;
  interests: string[];
}

export interface PersonaAgentOutput {
  personas: PersonaAgentPersona[];
}

export interface CampaignAgentOutput {
  summary: string;
  recommendedNetworks: ("meta" | "google" | "tiktok")[];
  budgetSplit: Record<string, number>;
  audiences: string[];
  creatives: { headline: string; body: string; callToAction: string }[];
}

export interface CriticIssue {
  agent: string;
  severity: "low" | "medium" | "high";
  issue: string;
}

export interface CriticAgentOutput {
  overallScore: number;
  issues: CriticIssue[];
  missingData: string[];
  recommendation: string;
}

/* ─────────────────────────  9 additional producer agents  ───────────────────────── */

export interface LandingPageAgentOutput {
  heroClarity: string;
  ctaRecommendation: string;
  messagingMismatches: string[];
  recommendedFixes: string[];
}

export interface PricingOfferAgentOutput {
  recommendedOfferType: string;
  pricingPositioning: string;
  guaranteeOrRiskReversal: string;
  urgencyAngle: string;
}

export interface LocalizationAgentOutput {
  priorityLanguages: string[];
  priorityRegions: string[];
  culturalAdaptationNotes: string[];
  translationCaveats: string[];
}

export interface SEOContentAgentOutput {
  contentGapsToFill: string[];
  onPageRecommendations: string[];
  titleTagSuggestion: string;
  metaDescriptionSuggestion: string;
}

export interface SeasonalityTimingAgentOutput {
  recommendedLaunchWindow: string;
  seasonalConsiderations: string[];
  dayPartingRecommendation: string;
}

export interface ChannelPlacementRecommendation {
  network: string;
  placement: string;
  rationale: string;
}

export interface ChannelPlacementAgentOutput {
  recommendedPlacements: ChannelPlacementRecommendation[];
  devicePriority: string;
}

export interface FunnelRetargetingAgentOutput {
  funnelStageSplit: Record<string, number>;
  retargetingAudiences: string[];
  awarenessAngles: string[];
}

export interface ObjectionHandlingAgentOutput {
  topObjections: string[];
  rebuttalAngles: string[];
  trustSignalsToHighlight: string[];
}

export interface ForecastingKPIAgentOutput {
  expectedCtrRange: string;
  expectedCpaRange: string;
  expectedRoasRange: string;
  primaryKpi: string;
  benchmarkReasoning: string[];
}

/* ─────────────────────────  reviewer agent #2: Compliance  ───────────────────────── */

export interface ComplianceFlag {
  agent: string;
  severity: "low" | "medium" | "high";
  issue: string;
  suggestion: string;
}

export interface ComplianceAgentOutput {
  overallRisk: "low" | "medium" | "high";
  flags: ComplianceFlag[];
  restrictedCategoryConcerns: string[];
  recommendation: string;
}
