import * as llmRouter from "../../infra/llmRouter.js";
import { resolveTaskModel } from "../../infra/llmTaskConfig.js";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../modules/logger/logger.js";
import { persistCrawlFacts, type ExtractedFact } from "./crawlPersistence.js";

const MAX_CONTENT_CHARS = 18_000;

const FACT_EXTRACTION_TOOL = {
  name: "emit_crawl_facts",
  description: "Return every concrete, verifiable fact found in the crawled website pages, each with its source page URL and a confidence score.",
  input_schema: {
    type: "object" as const,
    properties: {
      facts: {
        type: "array",
        description:
          "Concrete, verifiable claims only (prices, product names, named customers, guarantees, plan tiers) — no opinions or summaries.",
        items: {
          type: "object",
          properties: {
            field: { type: "string", description: "Dot-path label, e.g. pricing.startingPrice, product.name, usp, guarantee, notableCustomer" },
            value: { type: "string" },
            sourceUrl: { type: "string", description: "The crawled page URL this fact was read from — must be one of the [Page: ...] URLs in the prompt" },
            confidence: { type: "number", description: "0-1" },
          },
          required: ["field", "value", "sourceUrl", "confidence"],
        },
      },
    },
    required: ["facts"],
  },
};

/**
 * Standalone fact extraction over a persisted crawl's pages — one structured LLM call that
 * turns CrawlPage.cleanedText into CrawlFact rows (fact -> source page -> confidence).
 *
 * This is what makes the main campaign-generation pipeline fact-grounded: the onboarding
 * deep-research path extracts facts as a side effect of analyzeProduct/analyzeAudience
 * (modules/onboarding/analysis.ts), but the research-orchestrator path only persists pages,
 * so without this step the fact-grounded agents (creative/campaign/critic) would always see
 * an empty facts list for pipeline-generated campaigns.
 *
 * Returns the number of facts persisted. 0 (never a throw upward from missing data) when
 * the crawl has no pages or no model is configured — real facts or none, no fallback facts.
 */
export async function extractAndPersistCrawlFacts(crawlJobId: string): Promise<number> {
  const pages = await prisma.crawlPage.findMany({
    where: { crawlJobId, cleanedText: { not: null } },
    orderBy: { relevanceScore: "desc" },
    select: { url: true, cleanedText: true },
  });
  if (pages.length === 0) return 0;

  const content = pages
    .map((p) => `[Page: ${p.url}]\n${p.cleanedText}`)
    .join("\n\n")
    .slice(0, MAX_CONTENT_CHARS);

  const { data: result } = await llmRouter.runStructured<{ facts: ExtractedFact[] }>(resolveTaskModel("crawl-fact-extraction"), {
    maxTokens: 2048,
    tool: FACT_EXTRACTION_TOOL,
    messages: [
      {
        role: "user",
        content: `Extract every concrete, verifiable fact from these crawled website pages. For each fact give the exact page URL it came from and your confidence in it.\n\n${content}`,
      },
    ],
  });
  if (!result || !Array.isArray(result.facts) || result.facts.length === 0) {
    logger.info(`extractAndPersistCrawlFacts: model returned no facts for crawl ${crawlJobId}`);
    return 0;
  }

  return persistCrawlFacts(crawlJobId, result.facts);
}
