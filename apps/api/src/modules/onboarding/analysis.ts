import { llm, runStructured } from "../../infra/llmClient.js";
import type { AudienceAnalysis, ProductAnalysis, ScrapedSite } from "../../types/index.js";
import { scrapeUrl } from "./scraper.js";
import { logger } from "../logger/logger.js";

interface ExtractedFact {
  field: string;
  value: string;
  sourceUrl: string;
  confidence: number;
}

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

function siteContentForPrompt(site: ScrapedSite, maxChars: number): string {
  if (!site.pages || site.pages.length === 0) return site.excerpt.slice(0, maxChars);
  const tagged = site.pages.map((p: { url: string; cleanedText: string }) => `[Page: ${p.url}]\n${p.cleanedText}`).join("\n\n");
  return tagged.slice(0, maxChars);
}

function stripFacts<T extends { facts?: ExtractedFact[] }>(result: T): Omit<T, "facts"> {
  const { facts, ...rest } = result;
  return rest;
}

export async function analyzeProduct(site: ScrapedSite, _options: { crawlJobId?: string } = {}): Promise<ProductAnalysis> {
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
  return stripFacts(result);
}

export async function analyzeAudience(site: ScrapedSite, product: ProductAnalysis, _options: { crawlJobId?: string } = {}): Promise<AudienceAnalysis> {
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
  return stripFacts(result);
}

export interface DeepResearchResult {
  site: ScrapedSite;
  product: ProductAnalysis;
  audience: AudienceAnalysis;
}

export interface DeepResearchOptions {
  businessId?: string;
  workspaceId?: string;
}

export async function runDeepResearch(url: string, _options: DeepResearchOptions = {}): Promise<DeepResearchResult> {
  const site = await scrapeUrl(url);
  const product = await analyzeProduct(site);
  const audience = await analyzeAudience(site, product);
  return { site, product, audience };
}
