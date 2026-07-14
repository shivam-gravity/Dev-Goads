import type { Citation } from "../../types/index.js";

/**
 * The Competitor Intelligence Engine's own type surface — deliberately separate from
 * research/types/index.ts's CompetitorData/CompetitorEntry (which stay exactly as they
 * are, feeding the existing 9-provider pipeline / ResearchContext / the 10 AI agents
 * unchanged). This is a new, additive capability, not a replacement of CompetitorProvider.
 */

/** A name discovered from one or more independent sources, before enrichment. */
export interface DiscoveredCompetitor {
  name: string;
  url?: string;
  /** Which independent sources surfaced this name — "direct-search" | "alternatives-search"
   * | "research-memory", possibly more than one. Corroboration across sources is itself a
   * confidence signal (see ENRICHMENT/fusion) — a name only one source mentions is weaker
   * evidence than one three sources independently agree on. */
  mentionedBy: string[];
}

export interface CompetitorProfile {
  name: string;
  url?: string;
  positioning: string;
  pricing: string;
  targetAudience: string;
  valueProposition: string;
  strengths: string[];
  weaknesses: string[];
  technologyStack: string[];
  estimatedMarketingStrategy: string;
  /** e.g. "~15% of named-competitor set" or "Unknown — no market-share data found" */
  marketShare: string;
  /** Best-effort estimate of this competitor's ad spend, e.g. "$50K-$100K/mo (estimated)" */
  estimatedAdBudget: string;
  /** How this competitor differentiates itself from the rest of the field. */
  differentiation: string;
  evidence: string[];
  citations: Citation[];
  /** 0-1 — see enrichment.ts's computeProfileConfidence for exactly what feeds this. */
  confidence: number;
  /** How many independent discovery sources surfaced this competitor at all — carried
   * through from DiscoveredCompetitor for callers/fusion to weigh alongside confidence. */
  mentionedBySourceCount: number;
}

export interface CompetitorIntelligenceReport {
  businessUrl: string;
  businessName?: string;
  competitors: CompetitorProfile[];
  sourcesUsed: string[];
  fusion: {
    conflicts: import("../knowledge/KnowledgeFusionEngine.js").FusionConflict[];
    overallConfidence: number;
  };
  generatedAt: string;
}
