import { withPage } from "./browser.js";

/**
 * Rasterize an SVG document to a PNG using the shared headless Chromium. Meta's /adimages endpoint
 * rejects SVG (and can't fetch a localhost/relative URL), so ad creatives generated as SVG
 * (vectorAdImageService) must be turned into raster PNG bytes before upload. Chromium is already a
 * dependency of this service (Playwright), so this needs no new native image library — which is the
 * whole reason SVG rasterization lives here rather than in apps/api.
 *
 * The SVG is rendered at its own width/height; `width`/`height` override the viewport (and are
 * applied to the <svg> element) so callers can request a specific output size (e.g. 1080x1080).
 * Returns the PNG as a Buffer.
 */
export async function renderSvgToPng(svg: string, width = 1080, height = 1080): Promise<Buffer> {
  return withPage(async (page) => {
    await page.setViewportSize({ width, height });
    // Inline the SVG in a zero-margin white page; force the svg to fill the viewport so the PNG is
    // exactly width x height regardless of the source's own dimensions.
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>
        html,body{margin:0;padding:0;background:#ffffff}
        svg{display:block;width:${width}px;height:${height}px}
      </style></head><body>${svg}</body></html>`;
    await page.setContent(html, { waitUntil: "networkidle" });
    const el = await page.$("svg");
    // Screenshot the svg element if present (tight bounds), else the full viewport.
    const buffer = el
      ? await el.screenshot({ type: "png" })
      : await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
    return buffer;
  });
}
