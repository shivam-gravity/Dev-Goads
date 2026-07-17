import { prisma } from "../db/prisma.js";
import { logger } from "../modules/logger/logger.js";
import type { ResearchContext } from "./types/index.js";

/** One source-attributed fact from the website crawl, shaped for prompt injection. */
export interface VerifiedFact {
  field: string;
  value: string;
  sourceUrl: string | null;
  confidence: number;
}

const MAX_FACTS_FOR_PROMPT = 40;

/**
 * Loads the CrawlFact rows (fact -> source page -> confidence) persisted for this research
 * run's website crawl, so agents can ground their output in verified, source-attributed
 * claims instead of only the flattened research JSON. Keyed off context.website.crawlJobId,
 * which WebsiteProvider sets when page-level persistence ran.
 *
 * Deliberately best-effort: returns [] when there's no crawlJobId (fixture contexts, crawls
 * without a business), and [] on any DB error — an agent must never fail or block because
 * fact storage is unavailable, since everything it needs to produce *an* answer is already
 * in ResearchContext. Highest-confidence facts first, capped so the prompt stays bounded.
 */
export async function loadVerifiedFacts(context: ResearchContext): Promise<VerifiedFact[]> {
  const crawlJobId = context.website?.crawlJobId;
  if (!crawlJobId) return [];

  try {
    const rows = await prisma.crawlFact.findMany({
      where: { crawlJobId },
      orderBy: { confidence: "desc" },
      take: MAX_FACTS_FOR_PROMPT,
      include: { crawlPage: { select: { url: true } } },
    });
    return rows.map((r) => ({
      field: r.field,
      value: r.value,
      sourceUrl: r.crawlPage?.url ?? null,
      confidence: r.confidence,
    }));
  } catch (err) {
    logger.warn(`loadVerifiedFacts: couldn't load facts for crawl ${crawlJobId} — agent continues without them`, err);
    return [];
  }
}

/** Prompt-ready rendering: a compact JSON array, or an explicit "none" marker so the
 * template never interpolates an empty string the model might misread. */
export function verifiedFactsForPrompt(facts: VerifiedFact[]): string {
  if (facts.length === 0) return '"No verified crawl facts available for this run."';
  return JSON.stringify(facts);
}
