import * as cheerio from "cheerio";
import type { ScrapedSite } from "../../types/index.js";

const MAX_EXCERPT_LENGTH = 6000;
const FETCH_TIMEOUT_MS = 8000;

function normalizeUrl(input: string): string {
  const trimmed = input.trim();
  if (!/^https?:\/\//i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

/** Fetches a business's website and extracts the text a strategy engine can reason about. */
export async function scrapeUrl(input: string): Promise<ScrapedSite> {
  const url = normalizeUrl(input);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Enter a valid website URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are supported");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let html: string;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AdGoOnboardingBot/1.0)" },
      redirect: "follow",
    });
    if (!res.ok) throw new Error(`Site responded with ${res.status}`);
    html = await res.text();
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Timed out fetching that URL — check it's reachable and try again");
    }
    throw new Error(err instanceof Error ? `Couldn't fetch that URL: ${err.message}` : "Couldn't fetch that URL");
  } finally {
    clearTimeout(timeout);
  }

  const $ = cheerio.load(html);
  $("script, style, noscript, svg, nav, footer").remove();

  const title = $("title").first().text().trim() || parsed.hostname;
  const description =
    $('meta[name="description"]').attr("content")?.trim() ||
    $('meta[property="og:description"]').attr("content")?.trim() ||
    "";

  const headings = $("h1, h2, h3")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);

  const bodyText = $("body")
    .text()
    .replace(/\s+/g, " ")
    .trim();

  const excerpt = [title, description, ...headings, bodyText]
    .filter(Boolean)
    .join("\n")
    .slice(0, MAX_EXCERPT_LENGTH);

  if (!excerpt) {
    throw new Error("Couldn't extract any readable text from that page");
  }

  return { url, title, description, excerpt };
}
