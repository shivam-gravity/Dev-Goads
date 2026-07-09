import { openai, runStructured } from "../../infra/openaiClient.js";
import type { AudienceAnalysis, ProductAnalysis, ScrapedSite } from "../../types/index.js";
import { scrapeUrl } from "./scraper.js";
import { vectorStore, hashEmbedding } from "../../infra/vectorStore.js";

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
    },
    required: ["productName", "category", "summary", "valueProposition", "keyFeatures"],
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
    },
    required: ["primaryAudience", "segments", "painPoints", "buyingMotivations"],
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

export async function analyzeProduct(site: ScrapedSite): Promise<ProductAnalysis> {
  if (!openai) return fallbackProductAnalysis(site);

  const result = await runStructured<ProductAnalysis>({
    maxTokens: 1024,
    tool: PRODUCT_TOOL,
    messages: [
      {
        role: "user",
        content: `Analyze this business based on its website content and identify what it sells and why a customer would buy it.\n\nURL: ${site.url}\nTitle: ${site.title}\nMeta description: ${site.description}\n\nPage content:\n${site.excerpt}`,
      },
    ],
  });
  if (!result) throw new Error("Product analysis: model did not return structured output");
  return result;
}

export async function analyzeAudience(site: ScrapedSite, product: ProductAnalysis): Promise<AudienceAnalysis> {
  if (!openai) return fallbackAudienceAnalysis(product);

  const result = await runStructured<AudienceAnalysis>({
    maxTokens: 1024,
    tool: AUDIENCE_TOOL,
    messages: [
      {
        role: "user",
        content: `Based on this product analysis and the original website content, identify the likely target audience for ad targeting purposes.\n\nProduct analysis:\n${JSON.stringify(product, null, 2)}\n\nOriginal page content (for additional context):\n${site.excerpt.slice(0, 3000)}`,
      },
    ],
  });
  if (!result) throw new Error("Audience analysis: model did not return structured output");
  return result;
}

export interface DeepResearchResult {
  site: ScrapedSite;
  product: ProductAnalysis;
  audience: AudienceAnalysis;
}

/** Crawls a promotional URL and runs the full product + audience analysis in one pass. */
export async function runDeepResearch(url: string): Promise<DeepResearchResult> {
  const site = await scrapeUrl(url);
  const product = await analyzeProduct(site);
  const audience = await analyzeAudience(site, product);

  // Indexes this research so future onboarding runs can surface "businesses like this
  // one" — hashEmbedding is a placeholder until a real embeddings provider is wired in,
  // but it exercises the VectorStore interface's genuine upsert/query path today.
  await vectorStore.upsert([
    { id: site.url, embedding: hashEmbedding(site.excerpt), metadata: { url: site.url, title: site.title, category: product.category } },
  ]);

  return { site, product, audience };
}

/** Finds previously-researched sites whose content is most similar to the given text. */
export async function findSimilarResearchedSites(text: string, topK = 5) {
  const matches = await vectorStore.query(hashEmbedding(text), topK);
  return matches.map((m) => ({ url: m.id, score: m.score, ...m.metadata }));
}
