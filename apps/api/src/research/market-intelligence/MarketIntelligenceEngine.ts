import { openai, runStructured, runWebSearch } from "../../infra/openaiClient.js";
import { hostnameOf } from "../providers/support.js";
import { readMemory, writeMemory } from "../memory/MemoryCoordinator.js";
import type { Citation } from "../../types/index.js";

/**
 * Market Intelligence — a richer read on the market a business operates in than the
 * existing MarketProvider (research/providers/MarketProvider.ts, part of the 9-provider
 * pipeline) offers: 2 independent searches (a market-report-style angle covering
 * growth/demand/seasonality/trends, and a regulatory/emerging-competitor angle) combined
 * into one structured profile plus a computed opportunity score. Deliberately NOT wired
 * into MarketProvider/KnowledgeAggregator/ResearchContext — additive, standalone, same
 * posture as Competitor Intelligence relative to CompetitorProvider.
 */

export interface MarketIntelligenceInput {
  url: string;
  businessName?: string;
  industry?: string;
  workspaceId: string;
  businessId?: string;
}

export interface MarketIntelligenceReport {
  currentMarket: string;
  growth: string;
  demand: string;
  seasonality: string;
  trends: string[];
  emergingCompetitors: string[];
  regulations: string[];
  /** 0-100 — higher means more favorable conditions to enter/expand in this market right
   * now (strong growth+demand, few regulatory obstacles, room before saturation). */
  opportunityScore: number;
  citations: Citation[];
  confidence: number;
  generatedAt: string;
}

const MEMORY_KIND = "market-profile";

const MARKET_TOOL = {
  name: "emit_market_intelligence",
  description: "Return a structured market-intelligence profile.",
  input_schema: {
    type: "object" as const,
    properties: {
      currentMarket: { type: "string", description: "1-2 sentence description of the current state of this market" },
      growth: { type: "string", description: "Growth rate/trajectory, with a number if known" },
      demand: { type: "string" },
      seasonality: { type: "string", description: "Any seasonal demand patterns, or 'None significant' if flat" },
      trends: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      emergingCompetitors: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6, description: "Newer/smaller entrants gaining traction, distinct from established players" },
      regulations: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 6, description: "Regulatory factors affecting this market, or empty if none notable" },
      opportunityScore: { type: "integer", minimum: 0, maximum: 100, description: "0-100: how favorable current conditions are to enter/expand in this market" },
    },
    required: ["currentMarket", "growth", "demand", "seasonality", "trends", "emergingCompetitors", "regulations", "opportunityScore"],
  },
};

type MarketFields = Omit<MarketIntelligenceReport, "citations" | "confidence" | "generatedAt">;

function fallbackFields(subject: string): MarketFields {
  return {
    currentMarket: `Unknown — no live research performed for ${subject}.`,
    growth: "Unknown",
    demand: "Unknown",
    seasonality: "Unknown",
    trends: ["Not yet researched"],
    emergingCompetitors: [],
    regulations: [],
    opportunityScore: 0,
  };
}

function computeConfidence(usedFallback: boolean, citationCount: number): number {
  if (usedFallback) return 0.1;
  return citationCount === 0 ? 0.35 : Math.round(Math.min(0.55 + citationCount * 0.07, 0.9) * 100) / 100;
}

/**
 * Runs both market-angle searches, synthesizes one structured profile (with a computed
 * opportunity score), and persists it to Research Memory via the Memory Coordinator
 * (kind: "market-profile", the shortest-lived kind after pricing — market conditions
 * shift faster than competitor positioning does).
 */
export async function runMarketIntelligence(input: MarketIntelligenceInput): Promise<MarketIntelligenceReport> {
  const subject = input.businessName ?? hostnameOf(input.url);
  const industry = input.industry ?? "its category";
  const dedupKey = input.businessId ?? input.url;

  if (!openai) {
    return { ...fallbackFields(subject), citations: [], confidence: computeConfidence(true, 0), generatedAt: new Date().toISOString() };
  }

  const [marketResearch, regulatoryResearch, priorMatches] = await Promise.all([
    runWebSearch(`What is the current market size, growth rate, demand trends, and seasonality for ${industry} (relevant to a business like "${subject}")? Include any notable trends.`),
    runWebSearch(`What emerging/newer competitors are gaining traction in ${industry}, and what regulatory factors affect this market?`),
    readMemory({ kind: MEMORY_KIND, queryText: `${subject} — ${industry}`, workspaceId: input.workspaceId, excludeBusinessId: input.businessId, topK: 2 }),
  ]);

  const memoryContext = priorMatches.length > 0
    ? `\n\nPrior market research on similar businesses (Research Memory — verify before relying on it):\n${priorMatches.map((m) => `- ${m.content}`).join("\n")}`
    : "";

  const structured = await runStructured<MarketFields>({
    maxTokens: 1024,
    tool: MARKET_TOOL,
    messages: [
      {
        role: "user",
        content: `Synthesize a market-intelligence profile for "${subject}" (${industry}) from this research.\n\nMarket/growth/demand research:\n${marketResearch.narrative}\n\nEmerging competitors/regulatory research:\n${regulatoryResearch.narrative}${memoryContext}`,
      },
    ],
  });

  const usedFallback = !structured;
  const fields = structured ?? fallbackFields(subject);
  const citations = usedFallback ? [] : [...marketResearch.citations, ...regulatoryResearch.citations];
  const opportunityScore = Math.max(0, Math.min(100, Math.round(fields.opportunityScore)));

  const report: MarketIntelligenceReport = {
    ...fields,
    opportunityScore,
    citations,
    confidence: computeConfidence(usedFallback, citations.length),
    generatedAt: new Date().toISOString(),
  };

  if (!usedFallback) {
    try {
      await writeMemory({
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        kind: MEMORY_KIND,
        sourceUrl: input.url,
        dedupKey,
        content: `${subject} (${industry}): ${report.currentMarket} Growth: ${report.growth}. Opportunity score: ${report.opportunityScore}.`,
        metadata: report as unknown as Record<string, unknown>,
      });
    } catch {
      // Research Memory is an enhancement, never a reason to fail the report.
    }
  }

  return report;
}
