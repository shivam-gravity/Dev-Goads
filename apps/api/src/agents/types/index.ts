import type { ResearchContext } from "../../research/types/index.js";

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
  reasoning: string[];
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
