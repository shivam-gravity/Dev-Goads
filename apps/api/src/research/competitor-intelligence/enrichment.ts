import { openai, runStructured, runWebSearch } from "../../infra/openaiClient.js";
import { hostnameOf } from "../providers/support.js";
import type { Citation } from "../../types/index.js";
import type { CompetitorProfile, DiscoveredCompetitor } from "./types.js";

const ENRICHMENT_TOOL = {
  name: "emit_competitor_profile",
  description: "Return a detailed competitive-intelligence profile for one named competitor.",
  input_schema: {
    type: "object" as const,
    properties: {
      positioning: { type: "string", description: "How this competitor positions itself in the market" },
      pricing: { type: "string", description: "Known or estimated pricing model/tiers" },
      targetAudience: { type: "string" },
      valueProposition: { type: "string" },
      strengths: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      weaknesses: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      technologyStack: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 10, description: "Known or inferred technologies this competitor uses/builds on" },
      estimatedMarketingStrategy: { type: "string", description: "Best-effort read on their acquisition/marketing approach (channels, messaging themes, etc.)" },
    },
    required: ["positioning", "pricing", "targetAudience", "valueProposition", "strengths", "weaknesses", "technologyStack", "estimatedMarketingStrategy"],
  },
};

type EnrichmentFields = Omit<CompetitorProfile, "name" | "url" | "evidence" | "citations" | "confidence" | "mentionedBySourceCount">;

function fallbackProfile(name: string): EnrichmentFields {
  return {
    positioning: `Unknown — no live research performed for ${name}.`,
    pricing: "Unknown",
    targetAudience: "Unknown",
    valueProposition: "Unknown",
    strengths: ["Not yet researched"],
    weaknesses: ["Not yet researched"],
    technologyStack: [],
    estimatedMarketingStrategy: "Unknown",
  };
}

// Corporate-entity suffixes stripped before matching — a real citation title almost never
// repeats a competitor's full legal name verbatim (e.g. "PayPal Holdings, Inc.'s Strategy
// and Competitive Analysis" is clearly about "PayPal Holdings Inc." but fails an exact
// substring match on the comma and apostrophe-s alone). Calibrated against a live run
// (Stripe/Adyen competitor discovery) where this exact mismatch floored several genuinely
// well-cited competitors' confidence at 0.35 — the same class of "real data disagrees
// with my first-instinct string check" lesson as CompetitorProvider's MEMORY_MIN_SCORE.
const CORPORATE_SUFFIXES = /\b(inc|incorporated|corp|corporation|holdings|ltd|llc|co|company|group)\b\.?/g;

function coreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // drop parenthetical asides, e.g. "(formerly Square)"
    .replace(CORPORATE_SUFFIXES, " ")
    .replace(/[^a-z0-9\s]/g, " ") // punctuation (commas, apostrophes, periods) -> space
    .replace(/\s+/g, " ")
    .trim();
}

/** A citation counts as relevant if it's plausibly about THIS competitor — hostname match,
 * the competitor's cleaned core name appearing in the (also cleaned) citation title, or —
 * for a multi-word name where the full core name doesn't match — any single significant
 * (4+ char) word from it appearing in the title, so "Global Payments, Inc." still matches
 * a title that only says "Global Payments Company" without the corporate suffix either
 * side. Same shape as research/providers/support.ts's isRelevantCitation (duplicated, not
 * imported — that function is paired with the 9-provider pipeline's confidence formula
 * and the two are expected to be tuned independently as real usage data comes in for
 * each). */
function isRelevantCitation(citation: Citation, competitorName: string, competitorUrl?: string): boolean {
  const title = coreName(citation.title);
  const name = coreName(competitorName);
  if (name.length >= 3 && title.includes(name)) return true;
  const significantWords = name.split(" ").filter((w) => w.length >= 4);
  if (significantWords.some((w) => title.includes(w))) return true;
  if (competitorUrl) {
    try {
      const competitorHost = hostnameOf(competitorUrl).replace(/^www\./i, "").toLowerCase();
      const citationHost = hostnameOf(citation.url).replace(/^www\./i, "").toLowerCase();
      if (citationHost && citationHost === competitorHost) return true;
    } catch {
      // malformed URL on either side — fall through to "not relevant" rather than throw
    }
  }
  return false;
}

/**
 * Confidence combines two independent signals: how many discovery sources corroborated
 * this competitor existing at all (mentionedBySourceCount), and how well-grounded THIS
 * enrichment call's own citations are (relevance-checked, not just counted — see
 * CompetitorProvider's MEMORY_MIN_SCORE comment for why a real-data-calibrated citation
 * check matters more than raw count). A competitor named by all 3 sources but enriched
 * with zero relevant citations still lands in the middle, not high — corroborated
 * existence isn't the same as a well-grounded profile.
 */
function computeProfileConfidence(usedFallback: boolean, citations: Citation[], competitorName: string, competitorUrl: string | undefined, mentionedBySourceCount: number): number {
  if (usedFallback) return 0.1;

  const relevantCount = citations.filter((c) => isRelevantCitation(c, competitorName, competitorUrl)).length;
  const groundingScore = citations.length === 0 ? 0.3 : relevantCount === 0 ? 0.35 : Math.min(0.6 + relevantCount * 0.08, 0.9);
  const corroborationBonus = Math.min((mentionedBySourceCount - 1) * 0.05, 0.1);

  return Math.round(Math.min(groundingScore + corroborationBonus, 1) * 100) / 100;
}

/**
 * Deep-dives on ONE discovered competitor — a dedicated web search + structured
 * extraction, distinct from (and richer than) discovery's name-only extraction. Never
 * throws: degrades to a labeled, low-confidence fallback (no API key, no model output,
 * schema mismatch) rather than failing the whole batch over one competitor.
 */
export async function enrichCompetitor(discovered: DiscoveredCompetitor, businessContext: { industry?: string }): Promise<CompetitorProfile> {
  if (!openai) {
    return {
      name: discovered.name,
      url: discovered.url,
      ...fallbackProfile(discovered.name),
      evidence: [],
      citations: [],
      confidence: computeProfileConfidence(true, [], discovered.name, discovered.url, discovered.mentionedBy.length),
      mentionedBySourceCount: discovered.mentionedBy.length,
    };
  }

  const research = await runWebSearch(
    `Research the company/product "${discovered.name}"${businessContext.industry ? ` in ${businessContext.industry}` : ""}: its market positioning, pricing, target audience, value proposition, strengths, weaknesses, technology stack, and marketing strategy.`
  );

  const structured = research.narrative
    ? await runStructured<EnrichmentFields>({
        maxTokens: 1024,
        tool: ENRICHMENT_TOOL,
        messages: [{ role: "user", content: `Using this research, produce a competitive-intelligence profile for "${discovered.name}".\n\nResearch findings:\n${research.narrative}` }],
      })
    : null;

  const usedFallback = !structured;
  const fields = structured ?? fallbackProfile(discovered.name);
  const citations = usedFallback ? [] : research.citations;

  return {
    name: discovered.name,
    url: discovered.url,
    ...fields,
    evidence: citations.map((c) => `${c.title} (${c.url})`),
    citations,
    confidence: computeProfileConfidence(usedFallback, citations, discovered.name, discovered.url, discovered.mentionedBy.length),
    mentionedBySourceCount: discovered.mentionedBy.length,
  };
}
