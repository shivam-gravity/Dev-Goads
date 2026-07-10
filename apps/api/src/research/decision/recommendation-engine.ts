import { openai, runStructured } from "../../infra/openaiClient.js";
import { hostnameOf } from "../providers/support.js";
import type { ResearchContext } from "../types/index.js";
import type { DifficultyLevel, ImpactLevel, Priority, Recommendation, RecommendationCategory } from "./types.js";

/**
 * Recommendation Engine — turns a ResearchContext into a flat list of discrete, actionable
 * recommendations spanning the 7 categories the Decision Engine cares about. One structured
 * LLM call proposes the candidates (title/category/reason/affected-audience/difficulty/
 * expected-outcome); confidence and evidence are then computed deterministically from which
 * ResearchContext fields actually back each category, never from the model's own confidence
 * self-report — same principle the AI Agent Framework's providers/support.ts already
 * established (self-reported LLM confidence is well-documented to be poorly calibrated).
 */

const CATEGORY_FIELDS: Record<RecommendationCategory, (keyof ResearchContext)[]> = {
  positioning: ["company", "website", "market", "competitors"],
  audience: ["audience", "company"],
  channel: ["market", "competitors", "audience"],
  budget: ["market", "competitors"],
  creative: ["audience", "company", "keywords"],
  offer: ["competitors", "market"],
  messaging: ["audience", "keywords", "company"],
};

const RECOMMENDATION_TOOL = {
  name: "emit_recommendations",
  description: "Return a list of actionable marketing recommendations derived from research.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendations: {
        type: "array",
        minItems: 5,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "Short, actionable recommendation title" },
            category: { type: "string", enum: ["positioning", "audience", "channel", "budget", "creative", "offer", "messaging"] },
            priority: { type: "string", enum: ["low", "medium", "high", "critical"] },
            impact: { type: "string", enum: ["low", "medium", "high"] },
            reason: { type: "string", description: "Why this recommendation follows from the research" },
            affectedAudience: { type: "string", description: "Which audience segment this most affects" },
            estimatedDifficulty: { type: "string", enum: ["low", "medium", "high"] },
            expectedOutcome: { type: "string", description: "The concrete result if this recommendation is followed" },
          },
          required: ["title", "category", "priority", "impact", "reason", "affectedAudience", "estimatedDifficulty", "expectedOutcome"],
        },
      },
    },
    required: ["recommendations"],
  },
};

interface RecommendationCandidate {
  title: string;
  category: RecommendationCategory;
  priority: Priority;
  impact: ImpactLevel;
  reason: string;
  affectedAudience: string;
  estimatedDifficulty: DifficultyLevel;
  expectedOutcome: string;
}

/** Descriptive, traceable-back-to-a-field evidence strings — ResearchContext doesn't carry
 * raw citation URLs per field (those live only on ProviderResult, one layer up), so evidence
 * here points at the actual ingested data instead, which is exactly what a marketer reading
 * "why this recommendation" would want to verify. */
function evidenceForFields(context: ResearchContext, fields: (keyof ResearchContext)[]): string[] {
  const evidence: string[] = [];
  for (const field of fields) {
    const value = context[field];
    if (!value) continue;
    switch (field) {
      case "market": {
        const m = context.market;
        if (m) evidence.push(`Market: competition=${m.competitionLevel}${m.trends.length ? `, trends: ${m.trends.slice(0, 3).join(", ")}` : ""}`);
        break;
      }
      case "competitors": {
        const c = context.competitors;
        if (c) evidence.push(`Competitors: intensity=${c.competitionIntensity}${c.competitors.length ? `, e.g. ${c.competitors.slice(0, 3).map((x) => x.name).join(", ")}` : ""}`);
        break;
      }
      case "audience": {
        const a = context.audience;
        if (a) evidence.push(`Audience: ${a.primaryAudience}${a.painPoints.length ? `; pain points: ${a.painPoints.slice(0, 3).join(", ")}` : ""}`);
        break;
      }
      case "company": {
        const co = context.company;
        if (co) evidence.push(`Company: ${co.summary}`);
        break;
      }
      case "website": {
        const w = context.website;
        if (w) evidence.push(`Website: ${w.title} — ${w.description}`);
        break;
      }
      case "keywords": {
        const k = context.keywords;
        if (k) evidence.push(`Keywords: ${k.primaryKeywords.slice(0, 5).join(", ")}`);
        break;
      }
      case "news": {
        const n = context.news;
        if (n) evidence.push(`News: ${n.summary}`);
        break;
      }
      default:
        break;
    }
  }
  return evidence;
}

/** Deterministic 0-1 confidence for a recommendation in `category`, blended from the fused
 * (authority x per-result) confidence of whichever ResearchContext fields that category
 * depends on. Missing fields simply drop out of the average rather than zeroing it — a
 * recommendation backed by 2 of 3 relevant fields is weaker, not worthless. */
function computeRecommendationConfidence(context: ResearchContext, category: RecommendationCategory): number {
  // Defensive: category comes from the model's structured output — forced tool-choice with an
  // enum constrains it in practice, but isn't a runtime guarantee, so an unrecognized value
  // degrades to "no fields matched" (0.2 baseline below) instead of throwing.
  const fields = CATEGORY_FIELDS[category] ?? [];
  const scores: number[] = [];
  for (const field of fields) {
    if (!context[field]) continue;
    const provider = field === "keywords" ? "seo" : field === "competitors" ? "competitor" : (field as string);
    const fused = context.metadata.fusion?.fusedConfidenceByProvider[provider];
    const raw = context.metadata.confidenceByProvider[provider];
    if (typeof fused === "number") scores.push(fused);
    else if (typeof raw === "number") scores.push(raw);
  }
  if (scores.length === 0) return 0.2;
  const coverage = scores.length / fields.length;
  const avg = scores.reduce((sum, v) => sum + v, 0) / scores.length;
  return Math.round(Math.min(avg * (0.6 + 0.4 * coverage), 1) * 100) / 100;
}

function fallbackCandidates(): RecommendationCandidate[] {
  return [
    {
      title: "Clarify core positioning before scaling spend",
      category: "positioning",
      priority: "high",
      impact: "high",
      reason: "No live research was available to ground a specific recommendation.",
      affectedAudience: "All segments",
      estimatedDifficulty: "medium",
      expectedOutcome: "A clearer value proposition once research is re-run with a live API key.",
    },
  ];
}

/**
 * Generates the candidate recommendation set. Never throws: degrades to a single, clearly
 * low-confidence fallback recommendation with zero network calls when there's no
 * OPENAI_API_KEY, matching every other engine built on this pipeline.
 */
export async function generateRecommendations(context: ResearchContext): Promise<Recommendation[]> {
  const businessLabel = context.company?.name ?? hostnameOf(context.url);

  let candidates: RecommendationCandidate[];
  if (!openai) {
    candidates = fallbackCandidates();
  } else {
    const summaryParts: string[] = [];
    if (context.company) summaryParts.push(`Company: ${context.company.summary}`);
    if (context.website) summaryParts.push(`Website: ${context.website.title} — ${context.website.description}`);
    if (context.market) summaryParts.push(`Market: competition=${context.market.competitionLevel}, trends: ${context.market.trends.join(", ")}`);
    if (context.competitors) summaryParts.push(`Competitors: ${context.competitors.competitors.map((c) => c.name).join(", ")} (intensity: ${context.competitors.competitionIntensity})`);
    if (context.audience) summaryParts.push(`Audience: ${context.audience.primaryAudience}; pain points: ${context.audience.painPoints.join(", ")}`);
    if (context.keywords) summaryParts.push(`Keywords: ${context.keywords.primaryKeywords.join(", ")}`);
    if (context.news) summaryParts.push(`Recent news: ${context.news.summary}`);

    const structured = await runStructured<{ recommendations: RecommendationCandidate[] }>({
      maxTokens: 2048,
      tool: RECOMMENDATION_TOOL,
      messages: [
        {
          role: "user",
          content: `Based on this research for "${businessLabel}", propose 5-10 specific, actionable marketing recommendations spanning positioning, audience, channel, budget, creative, offer, and messaging.\n\n${summaryParts.join("\n")}`,
        },
      ],
    });
    candidates = structured?.recommendations ?? fallbackCandidates();
  }

  return candidates.map((candidate, index) => {
    const fields = CATEGORY_FIELDS[candidate.category] ?? [];
    return {
      id: `rec-${index + 1}`,
      title: candidate.title,
      category: candidate.category,
      priority: candidate.priority,
      impact: candidate.impact,
      confidence: computeRecommendationConfidence(context, candidate.category),
      reason: candidate.reason,
      evidence: evidenceForFields(context, fields),
      affectedAudience: candidate.affectedAudience,
      estimatedDifficulty: candidate.estimatedDifficulty,
      expectedOutcome: candidate.expectedOutcome,
    };
  });
}

export { CATEGORY_FIELDS, computeRecommendationConfidence };
