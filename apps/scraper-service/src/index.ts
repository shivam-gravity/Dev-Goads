import "./loadEnv.js";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { asyncHandler } from "./asyncHandler.js";
import { internalServiceAuth } from "./internalAuth.js";
import { sendError } from "./errorResponse.js";
import { closeBrowser } from "./scraping/browser.js";
import { scrapeProductUrl } from "./pipeline/scrapeWorker.js";
import { classifyImages } from "./pipeline/imageWorker.js";
import { parseProduct } from "./pipeline/productParser.js";
import { productFromJsonLd } from "./pipeline/researchProductShape.js";
import { normalizeProduct } from "./pipeline/llmNormalizer.js";
import { indexAndFindSimilar } from "./pipeline/vectorIndex.js";
import { generateAdCopy } from "./pipeline/creativeGenerator.js";
import { suggestCampaign } from "./pipeline/campaignSuggestions.js";
import { initErrorTracking, registerCrashReporting, captureError } from "../../api/src/infra/errorTracking.js";

initErrorTracking("polluxa-scraper-service");
registerCrashReporting("polluxa-scraper-service");

const app = express();
const PORT = Number(process.env.SCRAPER_SERVICE_PORT ?? 4003);

app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok", service: "scraper-service" }));

app.use(internalServiceAuth);

/* ═══════════════════════════════════════════════
   PRODUCT IMPORT
   Import URL -> Scrape Worker -> Image Worker -> Product Parser ->
   LLM Normalizer -> Vector Index -> Creative Generator -> Campaign Suggestions
   ═══════════════════════════════════════════════ */

const productUrlSchema = z.object({ url: z.string().min(1) });

// Scrape Worker only — useful when the caller wants to inspect raw extraction
// before spending an LLM call on it.
app.post("/products/scrape", asyncHandler(async (req, res) => {
  const parsed = productUrlSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    res.json(await scrapeProductUrl(parsed.data.url));
  } catch (err) {
    sendError(res, err, 422, "Failed to scrape product URL");
  }
}));

/* ═══════════════════════════════════════════════
   RESEARCH FALLBACK
   Firecrawl fallback for apps/api's research providers (see
   apps/api/src/infra/scrapeFallback.ts) — reuses the Scrape Worker's generic render+extract
   pipeline directly, NOT the full product-import pipeline (no image classification/LLM
   normalization — that's import-specific and would add needless OpenAI cost here).
   ═══════════════════════════════════════════════ */

const researchScrapeSchema = z.object({ url: z.string().min(1), wantProduct: z.boolean().optional() });

app.post("/research/scrape", asyncHandler(async (req, res) => {
  const parsed = researchScrapeSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  try {
    const scraped = await scrapeProductUrl(parsed.data.url);
    const product = parsed.data.wantProduct ? productFromJsonLd(scraped.jsonLd) : undefined;
    res.json({
      markdown: scraped.markdown,
      html: scraped.html,
      links: scraped.links,
      screenshot: scraped.screenshot,
      product,
      metadata: { title: scraped.title, description: scraped.description, sourceURL: scraped.url, statusCode: scraped.statusCode },
    });
  } catch (err) {
    sendError(res, err, 422, "Failed to scrape URL");
  }
}));

app.post("/products/import", asyncHandler(async (req, res) => {
  const parsed = productUrlSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  try {
    const scraped = await scrapeProductUrl(parsed.data.url);
    const images = await classifyImages(scraped.images);
    const draft = parseProduct(scraped, images);
    const product = await normalizeProduct(draft, scraped);
    const similarProducts = await indexAndFindSimilar(scraped.url, product);
    const adCopy = await generateAdCopy(product);
    const campaignSuggestion = await suggestCampaign(product, adCopy);

    const { images: _rawImageCandidates, ...scrapedSummary } = scraped;
    res.json({ scraped: scrapedSummary, images, product, similarProducts, adCopy, campaignSuggestion });
  } catch (err) {
    sendError(res, err, 422, "Failed to import product from URL");
  }
}));

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  captureError(err, { service: "polluxa-scraper-service" });
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`Polluxa Scraper Service listening on http://localhost:${PORT}`);
});

process.on("SIGTERM", async () => {
  await closeBrowser();
  server.close();
});
