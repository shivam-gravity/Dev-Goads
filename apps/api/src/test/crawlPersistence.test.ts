import { test, after } from "node:test";
import assert from "node:assert";
import { randomUUID } from "node:crypto";
import { prisma } from "../db/prisma.js";
import { objectStorage } from "../infra/objectStorage.js";
import {
  contentHash,
  createCrawlJob,
  markCrawlJobFailed,
  persistCrawlFacts,
  persistCrawlPages,
} from "../research/crawl/crawlPersistence.js";
import { domainFromWebsite } from "../modules/business/businessService.js";
import type { ScrapedSite } from "../types/index.js";
import { disconnectTestInfra } from "./testUtils/disconnectInfra.js";

after(disconnectTestInfra);

// 1x1 transparent PNG — a real decodable data URI so the screenshot path is exercised end-to-end.
const TINY_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

function fakeSite(url = "https://crawltest.example.com"): ScrapedSite {
  return {
    url,
    title: "Crawl Test Co",
    description: "A fake site for persistence tests",
    excerpt: "flattened text",
    images: [],
    crawledPages: [url, `${url}/pricing`],
    pagesDiscovered: 5,
    screenshot: TINY_PNG_DATA_URI,
    pages: [
      { url, title: "Crawl Test Co", pageType: "homepage", relevanceScore: 1, cleanedText: "Welcome to Crawl Test Co", html: "<html><body>home</body></html>" },
      { url: `${url}/pricing`, title: "Pricing", pageType: "pricing", relevanceScore: 0.95, cleanedText: "Plans start at ₹2,999/month", html: "<html><body>pricing</body></html>" },
    ],
  };
}

async function createFixtureBusiness(): Promise<string> {
  const id = randomUUID();
  await prisma.business.create({ data: { id, data: { id, name: "Crawl Test Co" } as any } });
  return id;
}

async function cleanupCrawl(crawlJobId: string, businessId: string): Promise<void> {
  const pages = await prisma.crawlPage.findMany({ where: { crawlJobId } });
  await prisma.crawlFact.deleteMany({ where: { crawlJobId } });
  await prisma.crawlPage.deleteMany({ where: { crawlJobId } });
  await prisma.crawlJob.delete({ where: { id: crawlJobId } }).catch(() => {});
  await prisma.business.delete({ where: { id: businessId } }).catch(() => {});
  for (const p of pages) {
    if (p.rawHtmlKey) await objectStorage.delete(p.rawHtmlKey);
    if (p.screenshotKey) await objectStorage.delete(p.screenshotKey);
  }
}

test("domainFromWebsite - normalizes scheme/www/casing and rejects garbage", () => {
  assert.strictEqual(domainFromWebsite("https://www.Example.com/pricing?x=1"), "example.com");
  assert.strictEqual(domainFromWebsite("example.com"), "example.com");
  assert.strictEqual(domainFromWebsite(undefined), null);
  assert.strictEqual(domainFromWebsite("http://"), null, "an empty host can't be a domain");
});

test("persistCrawlPages - one row per page, hashes content, offloads HTML + screenshot to object storage, completes the job", async () => {
  const businessId = await createFixtureBusiness();
  const site = fakeSite();
  const crawlJobId = await createCrawlJob({ businessId, workspaceId: "ws-crawltest", url: site.url });

  try {
    const pageIds = await persistCrawlPages(crawlJobId, site);
    assert.strictEqual(pageIds.length, 2);

    const job = await prisma.crawlJob.findUniqueOrThrow({ where: { id: crawlJobId } });
    assert.strictEqual(job.status, "completed");
    assert.strictEqual(job.pagesCrawled, 2);
    assert.strictEqual(job.pagesDiscovered, 5);
    assert.ok(job.completedAt);

    const pages = await prisma.crawlPage.findMany({ where: { crawlJobId }, orderBy: { relevanceScore: "desc" } });
    assert.strictEqual(pages.length, 2);

    const pricing = pages.find((p) => p.pageType === "pricing")!;
    assert.strictEqual(pricing.title, "Pricing");
    assert.strictEqual(pricing.contentHash, contentHash("Plans start at ₹2,999/month"));

    // Raw HTML round-trips through object storage, keeping Postgres blob-free.
    assert.ok(pricing.rawHtmlKey);
    const html = await objectStorage.get(pricing.rawHtmlKey!);
    assert.strictEqual(html!.toString("utf8"), "<html><body>pricing</body></html>");

    // Screenshot lands on the entry page only.
    const home = pages.find((p) => p.pageType === "homepage")!;
    assert.ok(home.screenshotKey);
    assert.ok(await objectStorage.get(home.screenshotKey!));
    assert.strictEqual(pricing.screenshotKey, null);
  } finally {
    await cleanupCrawl(crawlJobId, businessId);
  }
});

test("persistCrawlFacts - resolves sourceUrl to page rows (exact + trailing-slash variants), keeps unresolvable facts, clamps confidence", async () => {
  const businessId = await createFixtureBusiness();
  const site = fakeSite();
  const crawlJobId = await createCrawlJob({ businessId, workspaceId: "ws-crawltest", url: site.url });

  try {
    await persistCrawlPages(crawlJobId, site);

    const count = await persistCrawlFacts(crawlJobId, [
      { field: "pricing.startingPrice", value: "₹2,999/month", sourceUrl: `${site.url}/pricing`, confidence: 0.98 },
      { field: "product.name", value: "Crawl Test Co", sourceUrl: `${site.url}/pricing/`, confidence: 2 }, // trailing slash + out-of-range confidence
      { field: "usp", value: "unattributed claim", sourceUrl: "https://elsewhere.example.com/blog", confidence: 0.4 },
    ]);
    assert.strictEqual(count, 3);

    const facts = await prisma.crawlFact.findMany({ where: { crawlJobId } });
    const pricingPage = await prisma.crawlPage.findFirstOrThrow({ where: { crawlJobId, pageType: "pricing" } });

    const price = facts.find((f) => f.field === "pricing.startingPrice")!;
    assert.strictEqual(price.crawlPageId, pricingPage.id, "exact sourceUrl should resolve to the pricing page");

    const name = facts.find((f) => f.field === "product.name")!;
    assert.strictEqual(name.crawlPageId, pricingPage.id, "trailing-slash sourceUrl should still resolve");
    assert.strictEqual(name.confidence, 1, "confidence must be clamped to [0, 1]");

    const usp = facts.find((f) => f.field === "usp")!;
    assert.strictEqual(usp.crawlPageId, null, "a fact from an uncrawled URL persists without page attribution");
  } finally {
    await cleanupCrawl(crawlJobId, businessId);
  }
});

test("markCrawlJobFailed - records the error and completion time", async () => {
  const businessId = await createFixtureBusiness();
  const crawlJobId = await createCrawlJob({ businessId, workspaceId: "ws-crawltest", url: "https://crawltest.example.com" });

  try {
    await markCrawlJobFailed(crawlJobId, "Timed out fetching that URL");
    const job = await prisma.crawlJob.findUniqueOrThrow({ where: { id: crawlJobId } });
    assert.strictEqual(job.status, "failed");
    assert.strictEqual(job.error, "Timed out fetching that URL");
    assert.ok(job.completedAt);
  } finally {
    await cleanupCrawl(crawlJobId, businessId);
  }
});
