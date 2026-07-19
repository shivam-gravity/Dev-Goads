import * as llmRouter from "../../infra/llmRouter.js";
import { resolveTaskModel } from "../../infra/llmTaskConfig.js";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../modules/logger/logger.js";
import { persistCrawlFacts, type ExtractedFact } from "./crawlPersistence.js";

const MAX_CONTENT_CHARS = 18_000;
// Below this, a page is either an unscored fallback-discovery link or a genuinely
// low-priority sitemap entry (e.g. old blog posts) — see discoverAndSelectPages in
// scraper.ts: the no-sitemap fallback path floors every candidate at 0.5, so this never
// excludes anything there, only the sitemap path's genuinely low-declared-priority pages.
const MIN_RELEVANCE_FOR_FACTS = 0.3;

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
    where: { crawlJobId, cleanedText: { not: null }, relevanceScore: { gte: MIN_RELEVANCE_FOR_FACTS } },
    orderBy: { relevanceScore: "desc" },
    select: { url: true, cleanedText: true, contentHash: true },
  });
  if (pages.length === 0) return 0;

  // Greedily packs whole pages (highest relevance first) into the char budget rather than
  // joining everything and slicing the result afterward — a blind post-join slice can cut a
  // page off mid-sentence at an arbitrary point, feeding the model a garbled tail instead of
  // simply not including a lower-relevance page. Exact-duplicate pages (same contentHash —
  // templated legal/boilerplate pages are the common case) are skipped outright: they cost
  // tokens without adding any fact the first copy didn't already offer.
  const seenHashes = new Set<string>();
  const parts: string[] = [];
  let remaining = MAX_CONTENT_CHARS;
  for (const p of pages) {
    // contentHash is nullable in the schema even though persistCrawlPages always sets it —
    // fall back to a per-page-unique key so a hypothetical null hash never wrongly dedupes
    // two unrelated pages against each other.
    const hashKey = p.contentHash ?? `no-hash:${p.url}`;
    if (seenHashes.has(hashKey)) continue;
    seenHashes.add(hashKey);
    const block = `[Page: ${p.url}]\n${p.cleanedText}`;
    if (block.length > remaining) {
      if (parts.length === 0) parts.push(block.slice(0, remaining)); // still give the model SOMETHING even if the single highest-relevance page alone blows the budget
      break;
    }
    parts.push(block);
    remaining -= block.length + 2; // "\n\n" join below
  }
  const content = parts.join("\n\n");

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

/**
 * In-memory sibling of extractAndPersistCrawlFacts: turns already-crawled page text into a
 * source-attributed fact table with ONE structured LLM call, WITHOUT touching the DB. This is
 * the heart of the fact-first pipeline — the orchestrator runs it once up-front, then the
 * business-identity providers reason from the returned facts instead of each making their own
 * search+LLM call. Collapsing ~17 per-provider retrieval calls into this single extraction is
 * what cuts token use (and free-tier throttling) while keeping every claim pinned to a real URL.
 *
 * `pages` is the refined crawl output (already boilerplate-stripped). Returns [] — never throws
 * upward — when there's no content or no model, so callers degrade to their prior search path.
 */
export async function extractFactsFromPages(
  pages: { url: string; text: string }[]
): Promise<ExtractedFact[]> {
  const usable = pages.filter((p) => p.text && p.text.trim().length > 0);
  if (usable.length === 0) return [];

  // Same greedy whole-page packing as the persisted path: fill the char budget with the
  // highest-value pages intact rather than blindly slicing a concatenation mid-sentence.
  const parts: string[] = [];
  let remaining = MAX_CONTENT_CHARS;
  for (const p of usable) {
    const block = `[Page: ${p.url}]\n${p.text}`;
    if (block.length > remaining) {
      if (parts.length === 0) parts.push(block.slice(0, remaining));
      break;
    }
    parts.push(block);
    remaining -= block.length + 2;
  }
  const content = parts.join("\n\n");

  try {
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
    if (!result || !Array.isArray(result.facts)) return [];
    return result.facts;
  } catch (err) {
    logger.warn("extractFactsFromPages: fact extraction failed — providers fall back to their search path", err);
    return [];
  }
}
