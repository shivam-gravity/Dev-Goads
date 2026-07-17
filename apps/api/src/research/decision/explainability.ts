import { readMemory } from "../memory/MemoryCoordinator.js";
import type { ResearchContext } from "../types/index.js";
import { CATEGORY_FIELDS } from "./recommendation-engine.js";
import type { ExplainabilityReport, MemoryReference, RankedRecommendation, RecommendationCategory } from "./types.js";

/**
 * Explainability Layer — pure data assembly, no LLM call. Every recommendation must be
 * traceable back to concrete signals: which ResearchContext providers backed it, which
 * Research Memory entries corroborate it, what Knowledge Fusion flagged as conflicting, and
 * the exact ranking-factor breakdown behind its score. Nothing here computes a new number —
 * it only surfaces numbers/facts the Ranking Engine and Knowledge Fusion already produced.
 */

const CATEGORY_MEMORY_KIND: Record<RecommendationCategory, string> = {
  positioning: "competitor-profile",
  audience: "audience-profile",
  channel: "market-profile",
  budget: "market-profile",
  creative: "creative-analysis",
  offer: "pricing-analysis",
  messaging: "creative-analysis",
};

function providerNameForField(field: string): string {
  if (field === "keywords") return "seo";
  if (field === "competitors") return "competitor";
  return field;
}

function supportingProvidersFor(context: ResearchContext, category: RecommendationCategory): string[] {
  return (CATEGORY_FIELDS[category] ?? []).filter((f) => context[f]).map((f) => providerNameForField(f as string));
}

function conflictingInformationFor(context: ResearchContext, category: RecommendationCategory): string[] {
  const fusion = context.metadata.fusion;
  if (!fusion) return [];
  const relevantProviders = new Set(supportingProvidersFor(context, category));
  return fusion.conflicts.filter((c) => c.sources.some((s) => relevantProviders.has(s))).map((c) => c.description);
}

async function memoryReferencesFor(context: ResearchContext, recommendation: RankedRecommendation): Promise<MemoryReference[]> {
  const kind = CATEGORY_MEMORY_KIND[recommendation.category];
  if (!kind) return [];
  try {
    const matches = await readMemory({
      kind,
      queryText: `${recommendation.affectedAudience} ${recommendation.title}`,
      workspaceId: context.workspaceId,
      excludeBusinessId: context.businessId,
      topK: 2,
    });
    return matches.map((m) => ({
      kind,
      sourceUrl: m.sourceUrl,
      snippet: m.content.slice(0, 240),
      similarity: m.similarity,
    }));
  } catch {
    return [];
  }
}

export async function explainRecommendations(context: ResearchContext, recommendations: RankedRecommendation[]): Promise<ExplainabilityReport[]> {
  return Promise.all(
    recommendations.map(async (recommendation) => ({
      recommendationId: recommendation.id,
      evidence: recommendation.evidence,
      supportingProviders: supportingProvidersFor(context, recommendation.category),
      memoryReferences: await memoryReferencesFor(context, recommendation),
      conflictingInformation: conflictingInformationFor(context, recommendation.category),
      confidenceBreakdown: recommendation.rankingFactors,
      freshness: recommendation.rankingFactors.freshness,
      sourceAuthority: recommendation.rankingFactors.sourceAuthority,
    }))
  );
}
