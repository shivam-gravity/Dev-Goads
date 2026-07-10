import { openai, runStructured, runWebSearch } from "../../infra/openaiClient.js";
import { hostnameOf } from "../providers/support.js";
import { writeMemory } from "../memory/MemoryCoordinator.js";
import type { Citation } from "../../types/index.js";

/**
 * Pricing Intelligence — the company's own starting price, set against the SPREAD of its
 * competitors' prices (median, range, and where the company sits within that range), not
 * just one company's number in isolation. Position + range is what makes a pricing number
 * actionable ("we're 40% above the median" means something; "$79/mo" alone doesn't).
 */

export interface PricingIntelligenceInput {
  url: string;
  businessName?: string;
  industry?: string;
  workspaceId: string;
  businessId?: string;
  competitors: { name: string; url?: string }[];
}

export interface PricePoint {
  name: string;
  startingPriceUsd: number | null;
  pricingSummary: string;
  citations: Citation[];
  confidence: number;
}

export type PricePosition = "below-range" | "low-end" | "mid-range" | "high-end" | "above-range" | "unknown";

export interface PricingIntelligenceReport {
  businessUrl: string;
  company: PricePoint;
  competitors: PricePoint[];
  median: number | null;
  range: { min: number; max: number } | null;
  position: PricePosition;
  recommendations: string[];
  generatedAt: string;
}

const MAX_ANALYZED_COMPETITORS = 6;
const MEMORY_KIND = "pricing-analysis";

const PRICE_EXTRACTION_TOOL = {
  name: "emit_pricing_summary",
  description: "Return a numeric starting-price estimate (in USD, monthly, or best equivalent) and a plain-text pricing summary.",
  input_schema: {
    type: "object" as const,
    properties: {
      startingPriceUsd: { type: ["number", "null"], description: "Best-effort numeric starting price in USD (monthly equivalent). Null if genuinely not determinable (e.g. fully custom/enterprise-only pricing)." },
      pricingSummary: { type: "string", description: "1-2 sentence plain-text description of the pricing model/tiers" },
    },
    required: ["startingPriceUsd", "pricingSummary"],
  },
};

const RECOMMENDATIONS_TOOL = {
  name: "emit_pricing_recommendations",
  description: "Return pricing recommendations given a company's position relative to its competitors.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    },
    required: ["recommendations"],
  },
};

function computeConfidence(usedFallback: boolean, citationCount: number, hasPrice: boolean): number {
  if (usedFallback) return 0.1;
  const base = citationCount === 0 ? 0.3 : Math.min(0.55 + citationCount * 0.08, 0.9);
  return Math.round((hasPrice ? base : Math.min(base, 0.5)) * 100) / 100;
}

async function extractPricePoint(name: string, industry: string | undefined): Promise<PricePoint> {
  if (!openai) {
    return { name, startingPriceUsd: null, pricingSummary: `Unknown — no live research performed for ${name}.`, citations: [], confidence: computeConfidence(true, 0, false) };
  }

  const research = await runWebSearch(`What does "${name}"${industry ? ` (${industry})` : ""} charge? Find their pricing page, plans, and starting price in USD.`);
  const structured = research.narrative
    ? await runStructured<{ startingPriceUsd: number | null; pricingSummary: string }>({
        maxTokens: 384,
        tool: PRICE_EXTRACTION_TOOL,
        messages: [{ role: "user", content: `Extract a numeric starting price (USD) and summary for "${name}" from this research:\n\n${research.narrative}` }],
      })
    : null;

  const usedFallback = !structured;
  const startingPriceUsd = structured?.startingPriceUsd ?? null;
  const pricingSummary = structured?.pricingSummary ?? `Unknown — no live research performed for ${name}.`;
  const citations = usedFallback ? [] : research.citations;

  return { name, startingPriceUsd, pricingSummary, citations, confidence: computeConfidence(usedFallback, citations.length, startingPriceUsd !== null) };
}

// Exported for direct unit testing — pure numeric logic, no reason to only exercise it
// through a real API call.
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

export function computePosition(companyPrice: number | null, competitorPrices: number[]): PricePosition {
  if (companyPrice === null || competitorPrices.length === 0) return "unknown";
  const min = Math.min(...competitorPrices);
  const max = Math.max(...competitorPrices);
  if (companyPrice < min) return "below-range";
  if (companyPrice > max) return "above-range";
  const spread = max - min;
  if (spread === 0) return "mid-range";
  const percentile = (companyPrice - min) / spread;
  if (percentile <= 0.33) return "low-end";
  if (percentile >= 0.67) return "high-end";
  return "mid-range";
}

async function writePricingMemory(point: PricePoint, input: PricingIntelligenceInput): Promise<void> {
  try {
    await writeMemory({
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      kind: MEMORY_KIND,
      sourceUrl: input.url,
      dedupKey: point.name.trim().toLowerCase(),
      content: `${point.name}: ${point.pricingSummary}`,
      metadata: point as unknown as Record<string, unknown>,
    });
  } catch {
    // Research Memory is an enhancement, never a reason to fail the report.
  }
}

/**
 * Extracts the company's own starting price plus each supplied competitor's (capped at 6
 * for cost), computes the competitor median/range, places the company's price within that
 * range, and asks the model for recommendations given that position. Persists every price
 * point to Research Memory via the Memory Coordinator (kind: "pricing-analysis") — the
 * shortest default TTL of any Intelligence engine's kind, since pricing changes faster
 * than positioning or audience profiles do.
 */
export async function runPricingIntelligence(input: PricingIntelligenceInput): Promise<PricingIntelligenceReport> {
  const businessLabel = input.businessName ?? hostnameOf(input.url);
  const competitorsToAnalyze = input.competitors.slice(0, MAX_ANALYZED_COMPETITORS);

  const [company, ...competitors] = await Promise.all([
    extractPricePoint(businessLabel, input.industry),
    ...competitorsToAnalyze.map((c) => extractPricePoint(c.name, input.industry)),
  ]);

  await Promise.all(
    [company, ...competitors].map((point) => (point.citations.length > 0 ? writePricingMemory(point, input) : Promise.resolve()))
  );

  const competitorPrices = competitors.map((c) => c.startingPriceUsd).filter((p): p is number => p !== null);
  const med = median(competitorPrices);
  const range = competitorPrices.length > 0 ? { min: Math.min(...competitorPrices), max: Math.max(...competitorPrices) } : null;
  const position = computePosition(company.startingPriceUsd, competitorPrices);

  let recommendations: string[] = ["Not enough pricing data to generate recommendations."];
  if (openai && position !== "unknown") {
    const result = await runStructured<{ recommendations: string[] }>({
      maxTokens: 512,
      tool: RECOMMENDATIONS_TOOL,
      messages: [
        {
          role: "user",
          content: `"${businessLabel}" charges $${company.startingPriceUsd}/mo starting. Competitor median is $${med}/mo (range $${range?.min}-$${range?.max}). This puts the company at "${position}". Recommend pricing/positioning actions given this.`,
        },
      ],
    });
    if (result) recommendations = result.recommendations;
  }

  return {
    businessUrl: input.url,
    company,
    competitors,
    median: med,
    range,
    position,
    recommendations,
    generatedAt: new Date().toISOString(),
  };
}
