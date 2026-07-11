import { createHash, randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { objectStorage } from "../../infra/objectStorage.js";
import { logger } from "../../modules/logger/logger.js";
import type { ScrapedPage, ScrapedSite } from "../../types/index.js";

/**
 * Persistence layer for website crawls: one CrawlJob row per crawl attempt, one CrawlPage
 * row per fetched page, with raw HTML (and the entry-page screenshot) offloaded to
 * objectStorage rather than stored inline in Postgres. Postgres keeps only the structured,
 * queryable fields (url/type/title/score/hash/cleaned text) plus the object-storage keys.
 */

export interface CreateCrawlJobInput {
  businessId: string;
  workspaceId: string;
  researchJobId?: string;
  url: string;
}

export async function createCrawlJob(input: CreateCrawlJobInput): Promise<string> {
  const id = randomUUID();
  await prisma.crawlJob.create({
    data: {
      id,
      businessId: input.businessId,
      workspaceId: input.workspaceId,
      researchJobId: input.researchJobId ?? null,
      url: input.url,
      status: "crawling",
      startedAt: new Date(),
    },
  });
  return id;
}

export async function markCrawlJobFailed(crawlJobId: string, error: string): Promise<void> {
  await prisma.crawlJob.update({
    where: { id: crawlJobId },
    data: { status: "failed", error, completedAt: new Date() },
  });
}

export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Decodes a `data:image/...;base64,...` URI into its raw bytes, or null if it isn't one. */
function decodeDataUri(dataUri: string): { buffer: Buffer; extension: string } | null {
  const match = dataUri.match(/^data:image\/(\w+);base64,(.+)$/);
  if (!match) return null;
  return { buffer: Buffer.from(match[2], "base64"), extension: match[1] === "jpeg" ? "jpg" : match[1] };
}

/**
 * Persists every fetched page of a completed crawl and marks the job completed. Raw HTML
 * goes to objectStorage under crawl/<jobId>/<pageId>.html; the entry-page screenshot (when
 * the Playwright service produced one) under crawl/<jobId>/<pageId>.<ext>. A single page
 * failing to persist its blob degrades to a row without rawHtmlKey rather than sinking the
 * whole crawl's persistence — the cleaned text in Postgres is the load-bearing copy.
 */
export async function persistCrawlPages(crawlJobId: string, site: ScrapedSite): Promise<string[]> {
  const pageIds: string[] = [];
  const rows: {
    id: string;
    crawlJobId: string;
    url: string;
    pageType: string;
    title: string;
    relevanceScore: number;
    contentHash: string;
    cleanedText: string;
    rawHtmlKey: string | null;
    screenshotKey: string | null;
  }[] = [];

  for (const page of site.pages ?? []) {
    const pageId = randomUUID();
    pageIds.push(pageId);

    let rawHtmlKey: string | null = null;
    try {
      const key = `crawl/${crawlJobId}/${pageId}.html`;
      await objectStorage.put(key, Buffer.from(page.html, "utf8"), "text/html");
      rawHtmlKey = key;
    } catch (err) {
      logger.warn(`persistCrawlPages: failed to store raw HTML for ${page.url} — keeping the row without it`, err);
    }

    let screenshotKey: string | null = null;
    const isEntryPage = page.url === site.url;
    if (isEntryPage && site.screenshot) {
      const decoded = decodeDataUri(site.screenshot);
      if (decoded) {
        try {
          const key = `crawl/${crawlJobId}/${pageId}.${decoded.extension}`;
          await objectStorage.put(key, decoded.buffer, `image/${decoded.extension === "jpg" ? "jpeg" : decoded.extension}`);
          screenshotKey = key;
        } catch (err) {
          logger.warn(`persistCrawlPages: failed to store screenshot for ${page.url}`, err);
        }
      }
    }

    rows.push({
      id: pageId,
      crawlJobId,
      url: page.url,
      pageType: page.pageType,
      title: page.title,
      relevanceScore: page.relevanceScore,
      contentHash: contentHash(page.cleanedText),
      cleanedText: page.cleanedText,
      rawHtmlKey,
      screenshotKey,
    });
  }

  await prisma.crawlPage.createMany({ data: rows });
  await prisma.crawlJob.update({
    where: { id: crawlJobId },
    data: {
      status: "completed",
      pagesDiscovered: site.pagesDiscovered,
      pagesCrawled: rows.length,
      completedAt: new Date(),
    },
  });

  return pageIds;
}

export interface ExtractedFact {
  field: string;
  value: string;
  sourceUrl?: string;
  confidence: number;
}

/**
 * Persists LLM-extracted facts with provenance. Each fact's sourceUrl is resolved to the
 * CrawlPage row of the same job whose url matches (exact match first, then pathname match
 * as models sometimes drop query strings/trailing slashes); unresolvable sources persist
 * with crawlPageId null rather than being dropped — an unattributed fact is still auditable.
 */
export async function persistCrawlFacts(crawlJobId: string, facts: ExtractedFact[]): Promise<number> {
  if (facts.length === 0) return 0;

  const pages = await prisma.crawlPage.findMany({
    where: { crawlJobId },
    select: { id: true, url: true },
  });
  const byUrl = new Map(pages.map((p) => [p.url, p.id]));
  const byPathname = new Map(
    pages.map((p) => {
      try {
        const u = new URL(p.url);
        return [u.origin + u.pathname.replace(/\/$/, ""), p.id] as const;
      } catch {
        return [p.url, p.id] as const;
      }
    })
  );

  const resolvePageId = (sourceUrl?: string): string | null => {
    if (!sourceUrl) return null;
    const exact = byUrl.get(sourceUrl);
    if (exact) return exact;
    try {
      const u = new URL(sourceUrl);
      return byPathname.get(u.origin + u.pathname.replace(/\/$/, "")) ?? null;
    } catch {
      return null;
    }
  };

  await prisma.crawlFact.createMany({
    data: facts.map((f) => ({
      id: randomUUID(),
      crawlJobId,
      crawlPageId: resolvePageId(f.sourceUrl),
      field: f.field,
      value: f.value,
      confidence: Math.max(0, Math.min(1, f.confidence)),
    })),
  });

  return facts.length;
}
