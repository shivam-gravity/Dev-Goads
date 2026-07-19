import { llm, runStructured, runWebSearch } from "../../infra/llmClient.js";
import { hostnameOf, sanitizeBusinessName } from "../providers/support.js";
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
  /** Verified facts from the business's OWN site (fact-first pipeline). Injected as
   * authoritative grounding so the analysis identifies the RIGHT market/category — without it
   * the generic "market size for X" search drifted to an unrelated market (e.g. "AI service
   * marketplaces / telecom" for what is actually a CRM/sales-software product). */
  verifiedFacts?: { field: string; value: string; sourceUrl?: string; confidence: number }[];
}

export type MarketLevel = "low" | "medium" | "high";

export interface GeographicDemandEntry {
  region: string;
  demandLevel: MarketLevel;
  notes?: string;
}

export interface MarketIntelligenceReport {
  currentMarket: string;
  growth: string;
  demand: string;
  seasonality: string;
  trends: string[];
  emergingCompetitors: string[];
  regulations: string[];
  /** Compound Annual Growth Rate, as stated/estimated in research, e.g. "14.2% CAGR (2024-2029)" */
  cagr?: string;
  /** Total Addressable Market size, e.g. "$42B globally" */
  tam?: string;
  /** Per-region demand breakdown, or empty if the research didn't surface regional detail. */
  geographicDemand: GeographicDemandEntry[];
  /** Categorical read the model extracts directly from the research narrative — kept
   * separate from opportunityScore below so the score itself never has to be an LLM
   * self-report (see computeOpportunityScore). */
  growthLevel: MarketLevel;
  demandLevel: MarketLevel;
  /** 0-100 — higher means more favorable conditions to enter/expand in this market right
   * now. Deterministically computed from growthLevel/demandLevel/regulations/
   * emergingCompetitors (see computeOpportunityScore) — never an LLM self-report, same
   * principle research/decision/simulation-engine.ts uses for its own scores: asking a
   * model to output a single calibrated 0-100 number produces scores that aren't reliably
   * comparable across runs, whereas the same model reliably categorizes growth/demand as
   * low/medium/high. */
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
      growthLevel: { type: "string", enum: ["low", "medium", "high"], description: "Categorical read of the growth rate/trajectory described in `growth`" },
      demandLevel: { type: "string", enum: ["low", "medium", "high"], description: "Categorical read of current demand strength described in `demand`" },
      cagr: { type: "string", description: "Compound Annual Growth Rate if stated/estimated in the research, e.g. \"14.2% CAGR (2024-2029)\", or omit if not found" },
      tam: { type: "string", description: "Total Addressable Market size if stated/estimated in the research, e.g. \"$42B globally\", or omit if not found" },
      geographicDemand: {
        type: "array",
        minItems: 0,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            region: { type: "string", description: "e.g. \"North America\", \"APAC\", \"Western Europe\"" },
            demandLevel: { type: "string", enum: ["low", "medium", "high"] },
            notes: { type: "string" },
          },
          required: ["region", "demandLevel"],
        },
        description: "Per-region demand breakdown, or empty if the research didn't surface regional detail",
      },
    },
    required: ["currentMarket", "growth", "demand", "seasonality", "trends", "emergingCompetitors", "regulations", "growthLevel", "demandLevel", "geographicDemand"],
  },
};

type MarketFields = Omit<MarketIntelligenceReport, "citations" | "confidence" | "generatedAt" | "opportunityScore">;

function fallbackFields(subject: string): MarketFields {
  return {
    currentMarket: `Unknown — no live research performed for ${subject}.`,
    growth: "Unknown",
    demand: "Unknown",
    seasonality: "Unknown",
    trends: ["Not yet researched"],
    emergingCompetitors: [],
    regulations: [],
    growthLevel: "low",
    demandLevel: "low",
    geographicDemand: [],
  };
}

function computeConfidence(usedFallback: boolean, citationCount: number): number {
  if (usedFallback) return 0.1;
  return citationCount === 0 ? 0.35 : Math.round(Math.min(0.55 + citationCount * 0.07, 0.9) * 100) / 100;
}

const LEVEL_POINTS: Record<MarketLevel, number> = { low: 20, medium: 60, high: 100 };

/**
 * Deterministic replacement for asking the model to self-report a 0-100 opportunity
 * score directly. Growth and demand (each independently categorized by the model, not
 * scored) each contribute up to 40 points; a flat +20 base reflects "a market exists at
 * all"; regulatory friction and emerging-competitor pressure each shave up to 10 points,
 * capped so neither factor alone can crater the score — only weak growth/demand can do
 * that, mirroring how regulations/competitors are real headwinds but not the whole story.
 */
export function computeOpportunityScore(growthLevel: MarketLevel, demandLevel: MarketLevel, regulationsCount: number, emergingCompetitorsCount: number): number {
  const growthComponent = LEVEL_POINTS[growthLevel] * 0.4;
  const demandComponent = LEVEL_POINTS[demandLevel] * 0.4;
  const regulationPenalty = Math.min(regulationsCount * 3, 10);
  const competitorPenalty = Math.min(emergingCompetitorsCount * 2, 10);
  const score = growthComponent + demandComponent + 20 - regulationPenalty - competitorPenalty;
  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Runs both market-angle searches, synthesizes one structured profile (with a computed
 * opportunity score), and persists it to Research Memory via the Memory Coordinator
 * (kind: "market-profile", the shortest-lived kind after pricing — market conditions
 * shift faster than competitor positioning does).
 */
export async function runMarketIntelligence(input: MarketIntelligenceInput): Promise<MarketIntelligenceReport> {
  // Strip placeholder tokens before using the name as the market subject — an ungrounded name
  // like "Polluxa Demo Business" otherwise leads the model to invent a market around the word
  // "Demo" (e.g. "demo automation software"). Falls back to the domain when nothing distinctive
  // remains, same anchor rule as buildSearchQuery.
  const cleanName = input.businessName ? sanitizeBusinessName(input.businessName) : "";
  const subject = cleanName || hostnameOf(input.url);
  const industry = input.industry ?? "its category";
  const dedupKey = input.businessId ?? input.url;

  if (!llm) {
    return { ...fallbackFields(subject), opportunityScore: 0, citations: [], confidence: computeConfidence(true, 0), generatedAt: new Date().toISOString() };
  }

  const [marketResearch, regulatoryResearch, priorMatches] = await Promise.all([
    runWebSearch(`What is the current market size (TAM), CAGR/growth rate, demand trends, seasonality, and regional/geographic demand breakdown for ${industry} (relevant to a business like "${subject}")? Include any notable trends.`),
    runWebSearch(`What emerging/newer competitors are gaining traction in ${industry}, and what regulatory factors affect this market?`),
    readMemory({ kind: MEMORY_KIND, queryText: `${subject} — ${industry}`, workspaceId: input.workspaceId, excludeBusinessId: input.businessId, topK: 2 }),
  ]);

  const memoryContext = priorMatches.length > 0
    ? `\n\nPrior market research on OTHER businesses, retrieved by loose text similarity (Research Memory — this may be about a completely different industry that just happens to use similar vocabulary; only reuse a finding below if it is genuinely about the same product category/market as "${subject}" (${industry}) — otherwise ignore it entirely, do not blend it in):\n${priorMatches.map((m) => `- ${m.content}`).join("\n")}`
    : "";

  // Authoritative grounding: the business's own facts pin down the REAL market/category, so the
  // synthesis sizes the correct market instead of whatever the generic search happened to return.
  const factsContext = input.verifiedFacts?.length
    ? `AUTHORITATIVE — verified facts from the business's own website. First infer the SPECIFIC market/category from these (be precise, e.g. "AI-powered CRM / sales automation software", not a vague "services" market), then size THAT market. Where the web research below is about a different market, IGNORE it:\n${input.verifiedFacts.slice(0, 40).map((f) => `- ${f.field}: ${f.value}`).join("\n")}\n\n`
    : "";

  const structured = await runStructured<MarketFields>({
    maxTokens: 1024,
    tool: MARKET_TOOL,
    messages: [
      {
        role: "user",
        content: `${factsContext}Synthesize a market-intelligence profile for "${subject}" (${industry}) grounded in the authoritative facts above.\n\nMarket/growth/demand research:\n${marketResearch.narrative}\n\nEmerging competitors/regulatory research:\n${regulatoryResearch.narrative}${memoryContext}`,
      },
    ],
  });

  const usedFallback = !structured;
  const fields = structured ?? fallbackFields(subject);
  const citations = usedFallback ? [] : [...marketResearch.citations, ...regulatoryResearch.citations];
  const opportunityScore = usedFallback ? 0 : computeOpportunityScore(fields.growthLevel, fields.demandLevel, fields.regulations.length, fields.emergingCompetitors.length);

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
