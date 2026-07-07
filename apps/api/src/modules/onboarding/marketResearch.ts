import Anthropic from "@anthropic-ai/sdk";
import { logger } from "../logger/logger.js";
import type { AudienceAnalysis, AudiencePersona, Citation, CompetitorBudgetAnalysis, DeepResearchBlock, MarketLocationAnalysis, ProductAnalysis, ScrapedSite } from "../../types/index.js";

const anthropic = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;

const MAX_USES_PER_CALL = 4;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour — long enough to absorb a user retrying/resubmitting the same URL, short enough that market data doesn't go stale for long-lived dev sessions

/**
 * The five research-block steps, in the fixed order the worker runs them — exported so
 * both the block functions below and the worker (which announces "in progress: X" via
 * setResearchSessionCurrentStep before each one starts) share one source of truth
 * instead of duplicating these strings.
 */
export const RESEARCH_STEPS = {
  productPositioning: "Analyzing product positioning, features, pricing and use cases",
  audienceProfile: "Analyzing target audience profile",
  competitorBudget: "Analyzing competitors and calculating daily budget recommendations",
  marketLocation: "Analyzing market trends and competition, recommending target locations",
  audiencePersonas: "Mining Meta Ads audience interest keywords and building audience personas",
} as const;

export interface WebResearchResult {
  narrative: string;
  citations: Citation[];
  searchesUsed: number;
}

const EMPTY_RESULT: WebResearchResult = { narrative: "", citations: [], searchesUsed: 0 };

interface CacheEntry {
  result: WebResearchResult;
  expiresAt: number;
}

// Process-local cache keyed by normalized prompt — deliberately simple (no Redis/DB
// round-trip) since this only needs to survive within one gateway process's lifetime to
// avoid the common case of a user re-submitting the same URL a few times in a row.
const cache = new Map<string, CacheEntry>();

function cacheKey(prompt: string): string {
  return prompt.trim().toLowerCase();
}

function readCache(prompt: string): WebResearchResult | null {
  const entry = cache.get(cacheKey(prompt));
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    cache.delete(cacheKey(prompt));
    return null;
  }
  return entry.result;
}

function writeCache(prompt: string, result: WebResearchResult): void {
  cache.set(cacheKey(prompt), { result, expiresAt: Date.now() + CACHE_TTL_MS });
}

/**
 * Runs one real, live web-search-backed research call — the one new primitive this
 * feature adds. Claude decides autonomously how many searches to run (up to
 * MAX_USES_PER_CALL) via Anthropic's server-side `web_search_20250305` tool (billed
 * through the existing ANTHROPIC_API_KEY, no separate search-provider account needed).
 *
 * Cost controls live here since every caller goes through this one chokepoint:
 * - MAX_USES_PER_CALL hard-caps real searches spent per call.
 * - The process-local cache above skips repeat spend for an identical prompt.
 * - No ANTHROPIC_API_KEY -> EMPTY_RESULT immediately, zero cost, zero network calls —
 *   the same mock-fallback contract every other function in this module follows.
 *
 * Never throws — a failed/unreachable search degrades to EMPTY_RESULT so one flaky
 * block can't sink a whole research session.
 */
export async function runWebResearch(prompt: string): Promise<WebResearchResult> {
  if (!anthropic) return EMPTY_RESULT;

  const cached = readCache(prompt);
  if (cached) return cached;

  try {
    const msg = await anthropic.messages.create({
      model: "claude-sonnet-5",
      max_tokens: 2048,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: MAX_USES_PER_CALL }],
      messages: [{ role: "user", content: prompt }],
    });

    let narrative = "";
    const citationsByUrl = new Map<string, Citation>();
    let searchesUsed = 0;

    for (const block of msg.content) {
      if (block.type === "text") {
        narrative += block.text;
        for (const citation of block.citations ?? []) {
          if (citation.type === "web_search_result_location") {
            citationsByUrl.set(citation.url, { url: citation.url, title: citation.title ?? citation.url });
          }
        }
      } else if (block.type === "web_search_tool_result") {
        searchesUsed += 1;
      }
    }

    const result: WebResearchResult = { narrative: narrative.trim(), citations: [...citationsByUrl.values()], searchesUsed };
    writeCache(prompt, result);
    return result;
  } catch (err) {
    logger.warn("runWebResearch failed — continuing with an empty result", err);
    return EMPTY_RESULT;
  }
}

const NO_SEARCH_DATA_SOURCE = "AI estimate — no live web search performed (ANTHROPIC_API_KEY not set)";
const NO_CITATIONS_DATA_SOURCE = "AI estimate based on site content and general market knowledge (no citable sources found)";

function fallbackProductPositioning(site: ScrapedSite): ProductAnalysis {
  return {
    productName: site.title,
    category: "General business",
    businessType: "Online business",
    summary: site.description || `A business operating at ${site.url}, based on its website content.`,
    valueProposition: "Distinct offering worth exploring further in the strategy step.",
    keyFeatures: ["Core product/service", "Online presence", "Customer-facing website"],
    pricingModel: "Not publicly listed",
    pricingRange: "Unknown — verify directly with the business",
    dataSource: NO_SEARCH_DATA_SOURCE,
  };
}

const PRODUCT_POSITIONING_TOOL = {
  name: "emit_product_positioning",
  description: "Return a structured, research-backed analysis of this business's product positioning, pricing, and market fit.",
  input_schema: {
    type: "object" as const,
    properties: {
      productName: { type: "string" },
      category: { type: "string", description: "e.g. SaaS, e-commerce, local service, mobile app, enterprise software" },
      businessType: { type: "string", description: "e.g. Solution & Online Service, E-commerce, Local Service" },
      summary: { type: "string", description: "2-3 sentences on what the business does and who it targets" },
      valueProposition: { type: "string" },
      keyFeatures: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
      pricingModel: { type: "string", description: "e.g. Custom/enterprise pricing, Subscription, One-time purchase" },
      pricingRange: { type: "string", description: "e.g. \"$5,000-$50,000+/year\" or \"$29-$99/month\"" },
    },
    required: ["productName", "category", "businessType", "summary", "valueProposition", "keyFeatures", "pricingModel", "pricingRange"],
  },
};

/**
 * The first deep-research block: real web-search-backed product/pricing positioning.
 * Two Claude calls — one to gather live research (runWebResearch, real citations when
 * ANTHROPIC_API_KEY is set), one to shape that narrative + the site's own content into
 * the structured schema above (same forced-tool-choice pattern as analysis.ts's
 * analyzeProduct). Falls back to fallbackProductPositioning with zero API calls when no
 * key is set — same mock-fallback contract as every other function in this module.
 */
export async function analyzeProductDeep(site: ScrapedSite, allowSearch = true): Promise<DeepResearchBlock<ProductAnalysis>> {
  const label = RESEARCH_STEPS.productPositioning;

  if (!anthropic) {
    return { key: "productPositioning", label, citations: [], data: fallbackProductPositioning(site) };
  }

  const research = allowSearch
    ? await runWebResearch(
        `Research the pricing, market positioning, and competitive category for the business at ${site.url} ("${site.title}"). ` +
          `Find: (1) its product/service pricing model and typical price range, (2) how it positions itself in its market, ` +
          `(3) the industry/market category it competes in.\n\nBusiness context from its own website:\n${site.excerpt.slice(0, 2000)}`
      )
    : EMPTY_RESULT;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    tools: [PRODUCT_POSITIONING_TOOL],
    tool_choice: { type: "tool", name: "emit_product_positioning" },
    messages: [
      {
        role: "user",
        content:
          `Using the web research findings below plus the site's own content, produce a structured product-positioning analysis.\n\n` +
          `Web research findings:\n${research.narrative || "(no live web research available — reason from the site content alone)"}\n\n` +
          `URL: ${site.url}\nTitle: ${site.title}\nSite content:\n${site.excerpt}`,
      },
    ],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Product positioning analysis: model did not return structured output");

  const data = toolUse.input as ProductAnalysis;
  data.dataSource = research.citations.length > 0 ? research.citations.map((c) => c.title).join(" + ") : NO_CITATIONS_DATA_SOURCE;

  return { key: "productPositioning", label, citations: research.citations, data };
}

function fallbackAudienceDeep(product: ProductAnalysis): AudienceAnalysis {
  return {
    primaryAudience: `People interested in ${product.category.toLowerCase()}`,
    segments: [
      { name: "New customers", description: "First-time visitors evaluating the offering" },
      { name: "Returning customers", description: "People already familiar with the brand" },
    ],
    painPoints: ["Uncertainty about which option fits their needs", "Limited time to research alternatives"],
    buyingMotivations: ["Convenience", "Trust and credibility", "Price/value"],
    demographics: { ageDistribution: "Unknown — no live research performed", genderRatio: "Unknown", occupation: "Unknown" },
    consumerCharacteristics: "Unknown — no live research performed",
    interestTags: [product.category],
    recommendedObjective: "Leads",
    recommendedPerformanceGoal: "Leads within landing-page",
    dataSource: NO_SEARCH_DATA_SOURCE,
  };
}

const AUDIENCE_DEEP_TOOL = {
  name: "emit_audience_deep",
  description: "Return a structured, research-backed target-audience analysis for this business.",
  input_schema: {
    type: "object" as const,
    properties: {
      primaryAudience: { type: "string" },
      segments: {
        type: "array", minItems: 2, maxItems: 4,
        items: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name", "description"] },
      },
      painPoints: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      buyingMotivations: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      ageDistribution: { type: "string", description: "e.g. \"30-39 years 42%, 40-49 years 35%, 50-60 years 18%, 25-29 years 5%\"" },
      genderRatio: { type: "string", description: "e.g. \"Male 68%, Female 32%\"" },
      occupation: { type: "string", description: "e.g. \"Primarily C-Suite (CIO, CTO, COO) 45%, IT Directors/Managers 30%\"" },
      consumerCharacteristics: { type: "string", description: "budget, price sensitivity, brand loyalty, buying cycle" },
      interestTags: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 10 },
      recommendedObjective: { type: "string", description: "e.g. Leads, Sales, Traffic, Awareness" },
      recommendedPerformanceGoal: { type: "string", description: "e.g. \"Leads within landing-page\"" },
    },
    required: ["primaryAudience", "segments", "painPoints", "buyingMotivations", "ageDistribution", "genderRatio", "occupation", "consumerCharacteristics", "interestTags", "recommendedObjective", "recommendedPerformanceGoal"],
  },
};

/** Second deep-research block: target-audience demographics and recommended campaign objective. Same web-research-then-structure pattern as analyzeProductDeep. */
export async function analyzeAudienceDeep(site: ScrapedSite, product: ProductAnalysis, allowSearch = true): Promise<DeepResearchBlock<AudienceAnalysis>> {
  const label = RESEARCH_STEPS.audienceProfile;

  if (!anthropic) {
    return { key: "audienceProfile", label, citations: [], data: fallbackAudienceDeep(product) };
  }

  const research = allowSearch
    ? await runWebResearch(
        `Research the demographic profile and buying behavior of decision-makers/buyers for a "${product.category}" business ` +
          `positioned as: ${product.summary}\n\nFind: (1) age/gender distribution of typical buyers, (2) occupation/role breakdown, ` +
          `(3) budget and buying-cycle characteristics, (4) relevant interest/professional categories for ad targeting.`
      )
    : EMPTY_RESULT;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1024,
    tools: [AUDIENCE_DEEP_TOOL],
    tool_choice: { type: "tool", name: "emit_audience_deep" },
    messages: [
      {
        role: "user",
        content:
          `Using the web research findings below plus the product analysis, produce a structured target-audience analysis.\n\n` +
          `Web research findings:\n${research.narrative || "(no live web research available — reason from the product analysis alone)"}\n\n` +
          `Product analysis:\n${JSON.stringify(product, null, 2)}`,
      },
    ],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Audience analysis: model did not return structured output");

  const raw = toolUse.input as any;
  const data: AudienceAnalysis = {
    primaryAudience: raw.primaryAudience,
    segments: raw.segments,
    painPoints: raw.painPoints,
    buyingMotivations: raw.buyingMotivations,
    demographics: { ageDistribution: raw.ageDistribution, genderRatio: raw.genderRatio, occupation: raw.occupation },
    consumerCharacteristics: raw.consumerCharacteristics,
    interestTags: raw.interestTags,
    recommendedObjective: raw.recommendedObjective,
    recommendedPerformanceGoal: raw.recommendedPerformanceGoal,
    dataSource: research.citations.length > 0 ? research.citations.map((c) => c.title).join(" + ") : NO_CITATIONS_DATA_SOURCE,
  };

  return { key: "audienceProfile", label, citations: research.citations, data };
}

function fallbackCompetitorBudget(): CompetitorBudgetAnalysis {
  return {
    competitors: ["Other providers in this category"],
    competitionIntensity: "Unknown — no live research performed",
    differentiators: ["Distinct offering worth exploring further in the strategy step"],
    budgetReasoning: ["No live pricing/CPC data available — using a conservative generic starting budget"],
    recommendedDailyBudgetCents: 5000,
    dataSource: NO_SEARCH_DATA_SOURCE,
  };
}

const COMPETITOR_BUDGET_TOOL = {
  name: "emit_competitor_budget",
  description: "Return a structured competitor landscape and a calculated recommended daily ad budget, showing the reasoning chain.",
  input_schema: {
    type: "object" as const,
    properties: {
      competitors: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Named real competitors, if found" },
      competitionIntensity: { type: "string", description: "e.g. \"High (CPC: $8-$15 for B2B enterprise software...)\"" },
      differentiators: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5, description: "How this business could differentiate vs. the named competitors" },
      budgetReasoning: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6, description: "The step-by-step math: product value -> CPA target -> CVR -> clicks needed -> blended CPC -> daily budget" },
      recommendedDailyBudgetCents: { type: "integer", description: "The final recommended daily budget in cents, e.g. 15000 for $150/day" },
    },
    required: ["competitors", "competitionIntensity", "differentiators", "budgetReasoning", "recommendedDailyBudgetCents"],
  },
};

/** Third deep-research block: named competitors, CPC/competition benchmarks, and a calculated daily budget recommendation. */
export async function analyzeCompetitorsAndBudget(site: ScrapedSite, product: ProductAnalysis, allowSearch = true): Promise<DeepResearchBlock<CompetitorBudgetAnalysis>> {
  const label = RESEARCH_STEPS.competitorBudget;

  if (!anthropic) {
    return { key: "competitorBudget", label, citations: [], data: fallbackCompetitorBudget() };
  }

  const research = allowSearch
    ? await runWebResearch(
        `Research the main competitors and typical advertising cost benchmarks (CPC/CPM on Meta, Google, LinkedIn) for a ` +
          `"${product.category}" business (${product.businessType ?? ""}) priced at ${product.pricingRange ?? "an unknown range"}. ` +
          `Find: (1) named real competitors, (2) CPC/ad-cost benchmarks for this category, (3) typical CAC:LTV or CPA benchmarks for this kind of product.`
      )
    : EMPTY_RESULT;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1536,
    tools: [COMPETITOR_BUDGET_TOOL],
    tool_choice: { type: "tool", name: "emit_competitor_budget" },
    messages: [
      {
        role: "user",
        content:
          `Using the web research findings below plus the product analysis, produce a structured competitor analysis and a ` +
          `calculated daily budget recommendation — show your reasoning chain (product value -> CPA target -> required clicks -> blended CPC -> daily $ figure) in budgetReasoning.\n\n` +
          `Web research findings:\n${research.narrative || "(no live web research available — reason from general category knowledge)"}\n\n` +
          `Product analysis:\n${JSON.stringify(product, null, 2)}`,
      },
    ],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Competitor/budget analysis: model did not return structured output");

  const data = toolUse.input as CompetitorBudgetAnalysis;
  data.dataSource = research.citations.length > 0 ? research.citations.map((c) => c.title).join(" + ") : NO_CITATIONS_DATA_SOURCE;

  return { key: "competitorBudget", label, citations: research.citations, data };
}

function fallbackMarketLocation(): MarketLocationAnalysis {
  return {
    recommendedRegion: "United States",
    alternativeRegions: ["United Kingdom", "Canada"],
    marketTrends: "Unknown — no live research performed.",
    competitionLevel: "Unknown — no live research performed",
    recommendedPlatform: "meta",
    placementRationale: "Meta is recommended as a low-cost, high-reach default for early-stage campaigns absent live CPC/ROAS data — revisit once real performance data is available.",
    dataSource: NO_SEARCH_DATA_SOURCE,
  };
}

const MARKET_LOCATION_TOOL = {
  name: "emit_market_location",
  description: "Return a structured market-trends, recommended-region, and recommended-ad-platform analysis with reasoning.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendedRegion: { type: "string" },
      alternativeRegions: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      marketTrends: { type: "string", description: "Growth rate, market size, adoption trends for this category" },
      competitionLevel: { type: "string", description: "e.g. \"High (Platform competition index 8/10)...\"" },
      recommendedPlatform: { type: "string", enum: ["meta", "google", "tiktok"] },
      placementRationale: { type: "string", description: "Why this platform, with specific CPC/CPM/ROAS reasoning where available" },
    },
    required: ["recommendedRegion", "alternativeRegions", "marketTrends", "competitionLevel", "recommendedPlatform", "placementRationale"],
  },
};

/** Fourth deep-research block: regional market trends and the recommended ad platform. */
export async function analyzeMarketAndLocation(site: ScrapedSite, product: ProductAnalysis, allowSearch = true): Promise<DeepResearchBlock<MarketLocationAnalysis>> {
  const label = RESEARCH_STEPS.marketLocation;

  if (!anthropic) {
    return { key: "marketLocation", label, citations: [], data: fallbackMarketLocation() };
  }

  const research = allowSearch
    ? await runWebResearch(
        `Research regional market trends and ad-platform performance comparisons (Meta vs Google vs LinkedIn, CPC/CPM/ROAS) ` +
          `for a "${product.category}" business. Find: (1) which region has the strongest market for this category, ` +
          `(2) overall market growth trends, (3) which ad platform tends to perform best for this category and why.`
      )
    : EMPTY_RESULT;

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 1536,
    tools: [MARKET_LOCATION_TOOL],
    tool_choice: { type: "tool", name: "emit_market_location" },
    messages: [
      {
        role: "user",
        content:
          `Using the web research findings below plus the product analysis, recommend a target region and ad platform with reasoning.\n\n` +
          `Web research findings:\n${research.narrative || "(no live web research available — reason from general category knowledge)"}\n\n` +
          `Product analysis:\n${JSON.stringify(product, null, 2)}`,
      },
    ],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Market/location analysis: model did not return structured output");

  const data = toolUse.input as MarketLocationAnalysis;
  data.dataSource = research.citations.length > 0 ? research.citations.map((c) => c.title).join(" + ") : NO_CITATIONS_DATA_SOURCE;

  return { key: "marketLocation", label, citations: research.citations, data };
}

function fallbackPersonas(audience: AudienceAnalysis, product: ProductAnalysis): AudiencePersona[] {
  const interests = audience.interestTags?.length ? audience.interestTags : [product.category, "Online shopping", "Digital services"];
  return audience.segments.map((segment) => ({
    name: segment.name,
    ageRange: "25-54",
    genderSplit: "Balanced distribution",
    details: segment.description,
    interests: interests.slice(0, 6),
  }));
}

const PERSONA_MINING_TOOL = {
  name: "emit_audience_personas",
  description: "Mine Meta-ads-style interest keywords from the product/audience/competitor analysis and group them into named audience personas.",
  input_schema: {
    type: "object" as const,
    properties: {
      personas: {
        type: "array",
        minItems: 4,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "e.g. \"Enterprise Tech Decision-Makers\"" },
            ageRange: { type: "string", description: "e.g. \"35-55\"" },
            genderSplit: { type: "string", description: "e.g. \"68% Male, 32% Female\"" },
            details: { type: "string", description: "1-2 sentences on who this persona is and why they convert" },
            interests: {
              type: "array", items: { type: "string" }, minItems: 6, maxItems: 12,
              description: "Real Meta-ads-style interest targeting categories (can include named brands/companies, technology terms, or professional interest categories)",
            },
          },
          required: ["name", "ageRange", "genderSplit", "details", "interests"],
        },
      },
    },
    required: ["personas"],
  },
};

/**
 * Fifth block: pure reasoning over the already-gathered analysis — deliberately NO web
 * search here. Claude's training data already covers common Meta ad-interest taxonomy
 * well enough for this, and skipping search keeps this block's cost/latency near zero
 * even on a fully "live" run, which matters since 4-6 personas x real searches would be
 * the single most expensive part of a session otherwise.
 */
export async function mineAudiencePersonas(
  product: ProductAnalysis,
  audience: AudienceAnalysis,
  competitor: CompetitorBudgetAnalysis
): Promise<DeepResearchBlock<AudiencePersona[]>> {
  const label = RESEARCH_STEPS.audiencePersonas;

  if (!anthropic) {
    return { key: "audiencePersonas", label, citations: [], data: fallbackPersonas(audience, product) };
  }

  const msg = await anthropic.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 2048,
    tools: [PERSONA_MINING_TOOL],
    tool_choice: { type: "tool", name: "emit_audience_personas" },
    messages: [
      {
        role: "user",
        content:
          `Based on this product, audience, and competitor analysis, mine real Meta-ads-style interest keywords from multiple ` +
          `dimensions (product-related interests, competitor brand interests, professional role interests, technology-trend ` +
          `interests, use-case interests) and group them into 4-6 named audience personas, each with its own interest sublist.\n\n` +
          `Product analysis:\n${JSON.stringify(product, null, 2)}\n\n` +
          `Audience analysis:\n${JSON.stringify(audience, null, 2)}\n\n` +
          `Competitor analysis:\n${JSON.stringify(competitor, null, 2)}`,
      },
    ],
  });

  const toolUse = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!toolUse) throw new Error("Persona mining: model did not return structured output");

  const data = (toolUse.input as { personas: AudiencePersona[] }).personas;
  return { key: "audiencePersonas", label, citations: [], data };
}
