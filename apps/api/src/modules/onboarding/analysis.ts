import { llm, runStructured } from "../../infra/llmClient.js";
import type { AudienceAnalysis, ProductAnalysis, ScrapedSite } from "../../types/index.js";
import { scrapeUrl } from "./scraper.js";
import { vectorStore, hashEmbedding } from "../../infra/vectorStore.js";
import { createCrawlJob, markCrawlJobFailed, persistCrawlFacts, persistCrawlPages, type ExtractedFact } from "../../research/crawl/crawlPersistence.js";
import { logger } from "../logger/logger.js";

/** Shared `facts` property spliced into both analysis tools — every concrete claim the model
 * makes gets a source page + confidence, persisted as CrawlFact rows when a crawlJobId is in
 * play. sourceUrl must be one of the crawled page URLs listed in the prompt. */
const FACTS_PROPERTY = {
  facts: {
    type: "array" as const,
    description:
      "Every concrete, verifiable claim extracted from the site (prices, product names, named customers, guarantees). For each: which crawled page URL it came from and a 0-1 confidence.",
    items: {
      type: "object" as const,
      properties: {
        field: { type: "string", description: "Dot-path label, e.g. pricing.startingPrice, product.name, usp, painPoint" },
        value: { type: "string" },
        sourceUrl: { type: "string", description: "The crawled page URL this fact was read from — must be one of the URLs shown in the prompt" },
        confidence: { type: "number", description: "0-1" },
      },
      required: ["field", "value", "sourceUrl", "confidence"],
    },
  },
};

const PRODUCT_TOOL = {
  name: "emit_product_analysis",
  description: "Return a structured analysis of what this business/product is, based on its website content.",
  input_schema: {
    type: "object" as const,
    properties: {
      productName: { type: "string" },
      category: { type: "string", description: "e.g. SaaS, e-commerce, local service, mobile app" },
      summary: { type: "string", description: "2-3 sentences on what the business does" },
      valueProposition: { type: "string", description: "One sentence on why a customer would choose this" },
      keyFeatures: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 6 },
      ...FACTS_PROPERTY,
    },
    required: ["productName", "category", "summary", "valueProposition", "keyFeatures", "facts"],
  },
};

const AUDIENCE_TOOL = {
  name: "emit_audience_analysis",
  description: "Return a structured target-audience analysis for this business.",
  input_schema: {
    type: "object" as const,
    properties: {
      primaryAudience: { type: "string", description: "One sentence describing the main target customer" },
      segments: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
          },
          required: ["name", "description"],
        },
      },
      painPoints: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      buyingMotivations: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
      ...FACTS_PROPERTY,
    },
    required: ["primaryAudience", "segments", "painPoints", "buyingMotivations", "facts"],
  },
};

function fallbackProductAnalysis(site: ScrapedSite): ProductAnalysis {
  return {
    productName: site.title,
    category: "General business",
    summary: site.description || `A business operating at ${site.url}, based on its website content.`,
    valueProposition: "Distinct offering worth exploring further in the strategy step.",
    keyFeatures: ["Core product/service", "Online presence", "Customer-facing website"],
  };
}

function fallbackAudienceAnalysis(product: ProductAnalysis): AudienceAnalysis {
  return {
    primaryAudience: `People interested in ${product.category.toLowerCase()}`,
    segments: [
      { name: "New customers", description: "First-time visitors evaluating the offering" },
      { name: "Returning customers", description: "People already familiar with the brand" },
    ],
    painPoints: ["Uncertainty about which option fits their needs", "Limited time to research alternatives"],
    buyingMotivations: ["Convenience", "Trust and credibility", "Price/value"],
  };
}

/** Page-tagged site content: each crawled page's text prefixed with its URL, so the model
 * can attribute facts to specific pages. Falls back to the flat excerpt for callers (API
 * routes, older payloads) that only have the flattened form. */
function siteContentForPrompt(site: ScrapedSite, maxChars: number): string {
  if (!site.pages || site.pages.length === 0) return site.excerpt.slice(0, maxChars);
  const tagged = site.pages.map((p) => `[Page: ${p.url}]\n${p.cleanedText}`).join("\n\n");
  return tagged.slice(0, maxChars);
}

/** Persists LLM-emitted facts (best-effort — a persistence failure never sinks the analysis
 * that produced them) and strips the `facts` key so callers keep receiving the exact
 * ProductAnalysis/AudienceAnalysis shape they always did. */
async function persistAndStripFacts<T extends { facts?: ExtractedFact[] }>(result: T, crawlJobId?: string): Promise<Omit<T, "facts">> {
  const { facts, ...rest } = result;
  if (crawlJobId && facts && facts.length > 0) {
    try {
      await persistCrawlFacts(crawlJobId, facts);
    } catch (err) {
      logger.warn(`persistAndStripFacts: failed to persist ${facts.length} facts for crawl ${crawlJobId}`, err);
    }
  }
  return rest;
}

export interface AnalysisOptions {
  /** When set, facts the model extracts are persisted as CrawlFact rows attached to this crawl's pages. */
  crawlJobId?: string;
}

export async function analyzeProduct(site: ScrapedSite, options: AnalysisOptions = {}): Promise<ProductAnalysis> {
  if (!llm) return fallbackProductAnalysis(site);

  const result = await runStructured<ProductAnalysis & { facts?: ExtractedFact[] }>({
    maxTokens: 2048,
    tool: PRODUCT_TOOL,
    messages: [
      {
        role: "user",
        content: `Analyze this business based on its website content and identify what it sells and why a customer would buy it. Also extract every concrete, verifiable fact (prices, product names, named customers, guarantees) with the exact page URL it came from and your confidence in it.\n\nURL: ${site.url}\nTitle: ${site.title}\nMeta description: ${site.description}\n\nWebsite content by page:\n${siteContentForPrompt(site, 6000 * 3)}`,
      },
    ],
  });
  if (!result) throw new Error("Product analysis: model did not return structured output");
  return persistAndStripFacts(result, options.crawlJobId);
}

export async function analyzeAudience(site: ScrapedSite, product: ProductAnalysis, options: AnalysisOptions = {}): Promise<AudienceAnalysis> {
  if (!llm) return fallbackAudienceAnalysis(product);

  const result = await runStructured<AudienceAnalysis & { facts?: ExtractedFact[] }>({
    maxTokens: 2048,
    tool: AUDIENCE_TOOL,
    messages: [
      {
        role: "user",
        content: `Based on this product analysis and the original website content, identify the likely target audience for ad targeting purposes. Also extract any concrete audience-related facts (named customer types, testimonial claims, case-study outcomes) with the exact page URL each came from and your confidence.\n\nProduct analysis:\n${JSON.stringify(product, null, 2)}\n\nWebsite content by page (for additional context):\n${siteContentForPrompt(site, 3000)}`,
      },
    ],
  });
  if (!result) throw new Error("Audience analysis: model did not return structured output");
  return persistAndStripFacts(result, options.crawlJobId);
}

export interface DeepResearchResult {
  site: ScrapedSite;
  product: ProductAnalysis;
  audience: AudienceAnalysis;
  /** Present when business context was supplied and page-level persistence succeeded. */
  crawlJobId?: string;
}

export interface DeepResearchOptions {
  /** When both are set, the crawl is persisted page-by-page (CrawlJob/CrawlPage, raw HTML
   * in object storage) and extracted facts get provenance rows (CrawlFact). Without them
   * the analysis still runs, it just isn't persisted at page granularity. */
  businessId?: string;
  workspaceId?: string;
}

/** Crawls a promotional URL and runs the full product + audience analysis in one pass. */
export async function runDeepResearch(url: string, options: DeepResearchOptions = {}): Promise<DeepResearchResult> {
  const site = await scrapeUrl(url);

  let crawlJobId: string | undefined;
  if (options.businessId && options.workspaceId) {
    try {
      crawlJobId = await createCrawlJob({ businessId: options.businessId, workspaceId: options.workspaceId, url: site.url });
      await persistCrawlPages(crawlJobId, site);
    } catch (err) {
      logger.warn(`runDeepResearch: page-level persistence failed for ${url} — analysis continues unpersisted`, err);
      if (crawlJobId) await markCrawlJobFailed(crawlJobId, err instanceof Error ? err.message : String(err)).catch(() => {});
      crawlJobId = undefined;
    }
  }

  const product = await analyzeProduct(site, { crawlJobId });
  const audience = await analyzeAudience(site, product, { crawlJobId });

  // Indexes this research so future onboarding runs can surface "businesses like this
  // one" — hashEmbedding is a placeholder until a real embeddings provider is wired in,
  // but it exercises the VectorStore interface's genuine upsert/query path today.
  await vectorStore.upsert([
    { id: site.url, embedding: hashEmbedding(site.excerpt), metadata: { url: site.url, title: site.title, category: product.category } },
  ]);

  return { site, product, audience, crawlJobId };
}

/** Finds previously-researched sites whose content is most similar to the given text. */
export async function findSimilarResearchedSites(text: string, topK = 5) {
  const matches = await vectorStore.query(hashEmbedding(text), topK);
  return matches.map((m) => ({ url: m.id, score: m.score, ...m.metadata }));
}
