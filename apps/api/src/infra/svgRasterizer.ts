import { logger } from "../modules/logger/logger.js";

// Rasterize an SVG ad creative to PNG bytes by calling scraper-service's /render/svg endpoint
// (Playwright/Chromium — no native image dependency in apps/api). Meta's /adimages rejects SVG and
// can't fetch a localhost/relative URL, so SVG creatives (vectorAdImageService) must become raster
// PNG bytes before upload. Returns null on any failure so the caller can fall back gracefully
// (publish the ad without an image rather than failing the whole launch).
const SCRAPER_SERVICE_URL = process.env.SCRAPER_SERVICE_URL ?? "http://localhost:4003";
const INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY;
const RENDER_TIMEOUT_MS = Number(process.env.SVG_RENDER_TIMEOUT_MS ?? 20_000);

export async function rasterizeSvgToPng(svg: string, width = 1080, height = 1080): Promise<Buffer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RENDER_TIMEOUT_MS);
  try {
    const res = await fetch(new URL("/render/svg", SCRAPER_SERVICE_URL).toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(INTERNAL_SERVICE_KEY ? { "X-Internal-Service-Key": INTERNAL_SERVICE_KEY } : {}),
      },
      body: JSON.stringify({ svg, width, height }),
      signal: controller.signal,
    });
    if (!res.ok) {
      logger.warn(`svgRasterizer: scraper /render/svg returned ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { pngBase64?: string };
    if (!json.pngBase64) return null;
    return Buffer.from(json.pngBase64, "base64");
  } catch (err) {
    logger.warn("svgRasterizer: failed to rasterize SVG (scraper-service unreachable or timed out)", err);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
