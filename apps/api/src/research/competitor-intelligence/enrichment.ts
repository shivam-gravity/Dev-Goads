import * as cheerio from "cheerio";
import { llm, runStructured, runWebSearch } from "../../infra/llmClient.js";
import { normalizeUrl } from "../../modules/onboarding/scraper.js";
import { FACT_GROUNDED_FLOOR, hostnameOf } from "../providers/support.js";
import type { Citation } from "../../types/index.js";
import type { CompetitorProfile, DiscoveredCompetitor } from "./types.js";

const CRAWL_TIMEOUT_MS = 8000;
const MAX_CRAWL_EXCERPT_LENGTH = 3000;

/**
 * Best-effort single-page fetch of a discovered competitor's own homepage — folded into
 * the enrichment prompt alongside the web-search narrative below, so the profile draws on
 * the competitor's own stated positioning/pricing (real page text), not only on how OTHER
 * sites describe them. Deliberately one page, not a full multi-page crawl like
 * WebsiteProvider's: this runs once per enriched competitor (up to MAX_ENRICHED_COMPETITORS
 * per job), so a full crawl per competitor would multiply job cost/latency substantially
 * for a supporting signal, not the primary one (real web search still is). Never throws —
 * returns null on any failure so a competitor with an unreachable/nonexistent site still
 * gets the existing search-only enrichment.
 */
async function crawlCompetitorExcerpt(url?: string): Promise<string | null> {
  if (!url) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CRAWL_TIMEOUT_MS);
  try {
    const res = await fetch(normalizeUrl(url), {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; PolluxaResearchBot/1.0)" },
    });
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    $("script, style, noscript, svg, nav, footer").remove();
    const title = $("title").first().text().trim();
    const description = $('meta[name="description"]').attr("content")?.trim() ?? "";
    const bodyText = $("body").text().replace(/\s+/g, " ").trim();
    const excerpt = [title, description, bodyText].filter(Boolean).join("\n").slice(0, MAX_CRAWL_EXCERPT_LENGTH);
    return excerpt || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

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
      marketShare: { type: "string", description: "Best-effort market-share estimate/read, e.g. \"~15% of named-competitor set\", or \"Unknown\" if no credible data" },
      estimatedAdBudget: { type: "string", description: "Best-effort estimate of this competitor's ad spend, e.g. \"$50K-$100K/mo (estimated)\", or \"Unknown\" if no credible data" },
      differentiation: { type: "string", description: "How this competitor differentiates itself from the rest of the field" },
    },
    required: ["positioning", "pricing", "targetAudience", "valueProposition", "strengths", "weaknesses", "technologyStack", "estimatedMarketingStrategy", "marketShare", "estimatedAdBudget", "differentiation"],
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
    marketShare: "Unknown",
    estimatedAdBudget: "Unknown",
    differentiation: "Unknown",
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
  // citations.length === 0 now most often means a real, model-knowledge-based profile of a named,
  // well-known competitor (fact-first path skips the flaky web search) — genuinely grounded in the
  // model's knowledge of that company, not an ungrounded guess. Score it 0.8 to match the
  // fact-grounded floor the market/audience engines use: a profile of a competitor that was named
  // FROM the business's own verified facts (e.g. Salesforce for a CRM) is as well-grounded as the
  // fact-based market read. A real relevant citation can still edge higher; the 0.1 fallback still
  // covers the truly-empty "Unknown" case above; a search that returned only OFF-topic citations
  // (relevantCount 0 but citations present) still lands at 0.35 — that's a weak, not grounded, read.
  const groundingScore = citations.length === 0 ? FACT_GROUNDED_FLOOR : relevantCount === 0 ? 0.35 : Math.min(0.6 + relevantCount * 0.08, 0.9);
  const corroborationBonus = Math.min((mentionedBySourceCount - 1) * 0.05, 0.1);

  return Math.round(Math.min(groundingScore + corroborationBonus, 1) * 100) / 100;
}

/**
 * Deep-dives on ONE discovered competitor — a dedicated web search + structured
 * extraction, distinct from (and richer than) discovery's name-only extraction. Never
 * throws: degrades to a labeled, low-confidence fallback (no API key, no model output,
 * schema mismatch) rather than failing the whole batch over one competitor.
 */
export async function enrichCompetitor(discovered: DiscoveredCompetitor, businessContext: { industry?: string; skipSearch?: boolean }): Promise<CompetitorProfile> {
  if (!llm) {
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

  // skipSearch (fact-first mode): don't run the per-competitor web search at all — profile the
  // named, well-known competitor from model knowledge (+ its own homepage if reachable). Avoids
  // both the flaky-backend latency and the off-topic-citation penalty that docked real profiles.
  const [research, crawlExcerpt] = await Promise.all([
    businessContext.skipSearch
      ? Promise.resolve({ narrative: "", citations: [] as Citation[], searchesUsed: 0 })
      : runWebSearch(
          `Research the company/product "${discovered.name}"${businessContext.industry ? ` in ${businessContext.industry}` : ""}: its market positioning, pricing, target audience, value proposition, strengths, weaknesses, technology stack, marketing strategy, estimated market share, estimated advertising budget/spend, and how it differentiates itself from competitors.`
        ).catch(() => ({ narrative: "", citations: [] as Citation[], searchesUsed: 0 })),
    crawlCompetitorExcerpt(discovered.url),
  ]);

  // Reason from model knowledge when the (flaky self-hosted) web search returns nothing rather
  // than falling straight to an "Unknown" profile: the discovered competitors are named, well-
  // known companies in the category (Salesforce, HubSpot, …), which the model can profile from
  // training. Previously a search miss → structured=null → 0.1-confidence "Unknown" profile,
  // which is what produced the empty competitor data on runs where the search backend stalled.
  // A page excerpt (when the competitor's own site was reachable) or general knowledge is enough.
  const hasSignal = !!research.narrative || !!crawlExcerpt;
  const structured = await runStructured<EnrichmentFields>({
    maxTokens: 1024,
    tool: ENRICHMENT_TOOL,
    messages: [
      {
        role: "user",
        content: hasSignal
          ? `Using this research, produce a competitive-intelligence profile for "${discovered.name}".\n\n` +
            `Research findings:\n${research.narrative || "(no live web research available — reason from what you know about this company)"}` +
            (crawlExcerpt ? `\n\nReal page content fetched directly from ${discovered.name}'s own website (ground positioning/pricing in this over secondhand descriptions where they conflict):\n${crawlExcerpt}` : "")
          : `Produce a competitive-intelligence profile for "${discovered.name}"${businessContext.industry ? ` in ${businessContext.industry}` : ""} from what you know about this company. If you are not confident about a specific field (e.g. exact pricing or ad budget), say "Unknown" for that field rather than guessing — but fill in what you do know about its positioning, audience, strengths, and differentiation.`,
      },
    ],
  });

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
