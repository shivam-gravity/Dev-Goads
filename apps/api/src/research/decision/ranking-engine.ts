import { contextFreshness } from "../knowledge/KnowledgeFusionEngine.js";
import { readMemory } from "../memory/MemoryCoordinator.js";
import type { ResearchContext } from "../types/index.js";
import { CATEGORY_FIELDS } from "./recommendation-engine.js";
import type { Recommendation, RankedRecommendation, RankingFactors, RankingWeights } from "./types.js";

/**
 * Ranking Engine — scores every recommendation on 7 weighted factors and blends them into
 * one Final Recommendation Score (0-100). Every factor is code-computed, never an LLM
 * self-report, and every factor reuses an existing, already-computed signal (Knowledge
 * Fusion's authority/freshness, Memory Coordinator's corroboration) rather than inventing a
 * parallel scoring system — read-only consumption of both, per the "do not modify" contract.
 */

export const DEFAULT_WEIGHTS: RankingWeights = {
  researchConfidence: 0.25,
  evidenceQuality: 0.15,
  sourceAuthority: 0.15,
  freshness: 0.1,
  businessRelevance: 0.15,
  crossProviderAgreement: 0.1,
  historicalSuccess: 0.1,
};

const MEMORY_KIND = "decision-recommendation";
// How long a prior recommendation stays a meaningful "this was corroborated before"
// signal — decision recommendations track fast-moving marketing judgment calls, so this is
// deliberately shorter than any existing intelligence-engine TTL (see MemoryCoordinator.ts).
const HISTORICAL_TTL_MS = 21 * 24 * 60 * 60 * 1000;
// Same horizon used to score how fresh the underlying ResearchContext itself is.
const RESEARCH_FRESHNESS_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function providerNameForField(field: string): string {
  if (field === "keywords") return "seo";
  if (field === "competitors") return "competitor";
  return field;
}

function sourceAuthorityFor(context: ResearchContext, category: Recommendation["category"]): number {
  const fields = CATEGORY_FIELDS[category] ?? [];
  const authorities = fields
    .filter((f) => context[f])
    .map((f) => context.metadata.fusion?.authorityByProvider[providerNameForField(f as string)])
    .filter((v): v is number => typeof v === "number");
  if (authorities.length === 0) return 0.5;
  return Math.round((authorities.reduce((sum, v) => sum + v, 0) / authorities.length) * 100) / 100;
}

function businessRelevanceFor(context: ResearchContext, category: Recommendation["category"]): number {
  const fields = CATEGORY_FIELDS[category] ?? [];
  if (fields.length === 0) return 0.5;
  const present = fields.filter((f) => context[f]).length;
  return Math.round((present / fields.length) * 100) / 100;
}

function crossProviderAgreementFor(context: ResearchContext, category: Recommendation["category"]): number {
  const fusion = context.metadata.fusion;
  if (!fusion) return 0.7;
  const relevantProviders = new Set((CATEGORY_FIELDS[category] ?? []).map((f) => providerNameForField(f as string)));
  const relevantConflicts = fusion.conflicts.filter((c) => c.sources.some((s) => relevantProviders.has(s)));
  if (relevantConflicts.length === 0) return 1;
  const penalty = relevantConflicts.reduce((sum, c) => sum + (c.severity === "high" ? 0.35 : c.severity === "medium" ? 0.2 : 0.1), 0);
  return Math.max(1 - penalty, 0);
}

/** Queries Research Memory for prior "decision-recommendation" entries similar to this
 * recommendation's title — recurring, previously-surfaced recommendations read as more
 * validated than a first-time suggestion. No prior entries (the common first-run case)
 * scores a neutral 0.5, i.e. "unproven, not disproven." */
async function historicalSuccessFor(context: ResearchContext, recommendation: Recommendation): Promise<number> {
  try {
    const matches = await readMemory({
      kind: MEMORY_KIND,
      queryText: `${recommendation.category}: ${recommendation.title}`,
      workspaceId: context.workspaceId,
      topK: 3,
      ttlMs: HISTORICAL_TTL_MS,
    });
    if (matches.length === 0) return 0.5;
    const avgScore = matches.reduce((sum, m) => sum + m.score, 0) / matches.length;
    return Math.round(Math.min(0.5 + avgScore * 0.5, 1) * 100) / 100;
  } catch {
    return 0.5;
  }
}

export function computeFinalScore(factors: RankingFactors, weights: RankingWeights = DEFAULT_WEIGHTS): number {
  const weightedSum =
    factors.researchConfidence * weights.researchConfidence +
    factors.evidenceQuality * weights.evidenceQuality +
    factors.sourceAuthority * weights.sourceAuthority +
    factors.freshness * weights.freshness +
    factors.businessRelevance * weights.businessRelevance +
    factors.crossProviderAgreement * weights.crossProviderAgreement +
    factors.historicalSuccess * weights.historicalSuccess;
  const weightTotal = Object.values(weights).reduce((sum, v) => sum + v, 0);
  return Math.round((weightedSum / weightTotal) * 10000) / 100;
}

export async function rankRecommendations(
  recommendations: Recommendation[],
  context: ResearchContext,
  weights: RankingWeights = DEFAULT_WEIGHTS
): Promise<RankedRecommendation[]> {
  const freshness = contextFreshness(context.metadata.generatedAt, RESEARCH_FRESHNESS_TTL_MS);

  const ranked = await Promise.all(
    recommendations.map(async (recommendation) => {
      const factors: RankingFactors = {
        researchConfidence: recommendation.confidence,
        evidenceQuality: Math.min(recommendation.evidence.length / 3, 1),
        sourceAuthority: sourceAuthorityFor(context, recommendation.category),
        freshness,
        businessRelevance: businessRelevanceFor(context, recommendation.category),
        crossProviderAgreement: crossProviderAgreementFor(context, recommendation.category),
        historicalSuccess: await historicalSuccessFor(context, recommendation),
      };
      return {
        ...recommendation,
        rankingFactors: factors,
        finalScore: computeFinalScore(factors, weights),
      };
    })
  );

  return ranked.sort((a, b) => b.finalScore - a.finalScore);
}
