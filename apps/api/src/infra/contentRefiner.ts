/**
 * Cheap, deterministic (NO LLM) refinement of crawled/searched web content before it's handed
 * to an LLM for research. Purpose: cut token cost. A raw crawl4ai markdown dump is mostly
 * boilerplate — nav menus, footers, cookie/consent banners, image tags, link soup, social
 * buttons — that costs input tokens without adding research signal. This strips that noise and
 * keeps only the passages that actually relate to the research query, so the LLM sees dense,
 * relevant text instead of a whole rendered page.
 *
 * This runs on EVERY enriched hit, so it must be fast and allocation-light — plain string/regex
 * work, no parsing library, no network, no model call. It is intentionally conservative: when
 * unsure it keeps a line rather than dropping it, because a wrongly-dropped fact is worse than a
 * few extra tokens.
 */

// Lines matching these are structural boilerplate, not content — dropped outright.
const BOILERPLATE_LINE = new RegExp(
  [
    "^\\s*$", // blank
    "^\\s*[|>#*_\\-=~`]+\\s*$", // pure markdown separators / rules
    "^\\s*!\\[", // image: ![alt](src)
    "^\\s*\\[!\\[", // linked image
    "cookie|consent|gdpr|privacy policy|terms of service|all rights reserved",
    "^\\s*(home|menu|search|login|log in|sign in|sign up|register|subscribe|newsletter)\\s*$",
    "^\\s*(share|tweet|follow us|back to top|skip to (content|main))\\b",
    "^\\s*(facebook|twitter|instagram|linkedin|youtube|tiktok)\\s*$",
    "^\\s*©", // copyright
  ].join("|"),
  "i"
);

// A line that is essentially just markdown links / navigation (mostly `[text](url)` with little
// prose around it) — high token cost, low research value.
const MOSTLY_LINKS = /^\s*(\[[^\]]*\]\([^)]*\)\s*[|·•\-]*\s*){2,}\s*$/;

/** Split the research prompt into meaningful lowercased keywords for relevance scoring.
 * Drops stopwords and short tokens so scoring keys off real subject terms (company/product/
 * market words), not filler. */
const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "what", "which", "their", "have", "has",
  "are", "was", "were", "will", "would", "about", "into", "than", "then", "them", "your", "you",
  "research", "analyze", "analysis", "find", "list", "main", "named", "business", "company",
  "provide", "identify", "describe", "including", "based", "given", "using", "http", "https",
  "www", "com",
]);

function keywordsFromPrompt(prompt: string): string[] {
  const seen = new Set<string>();
  for (const raw of prompt.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw)) continue;
    seen.add(raw);
  }
  return [...seen];
}

export interface RefineOptions {
  /** Hard cap on the returned character count — the real token-budget guard. */
  maxChars?: number;
  /** Keep only lines that contain at least one prompt keyword. When false, boilerplate is still
   * stripped but non-matching prose is kept (used when the crawl is the primary source, not a
   * supporting search hit). */
  relevanceFilter?: boolean;
}

const DEFAULT_MAX_CHARS = 2000;

/**
 * Refine one crawled/searched document against the research prompt. Returns dense, de-noised
 * text no longer than maxChars. Pure function — same input always yields the same output.
 */
export function refineContent(content: string, prompt: string, opts: RefineOptions = {}): string {
  if (!content) return "";
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const relevanceFilter = opts.relevanceFilter ?? true;
  const keywords = relevanceFilter ? keywordsFromPrompt(prompt) : [];

  const kept: string[] = [];
  const seen = new Set<string>(); // collapse duplicate lines (repeated nav/CTAs across a page)
  let total = 0;

  for (const rawLine of content.split("\n")) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (line.length < 3) continue;
    if (BOILERPLATE_LINE.test(line) || MOSTLY_LINKS.test(line)) continue;

    // Strip inline markdown link syntax down to just the visible text, dropping the URL — the
    // URL is rarely useful to the reasoning model and is pure token cost. `[Pricing](/p)` -> `Pricing`.
    const cleaned = line.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[*_`]{1,3}/g, "").trim();
    if (cleaned.length < 3) continue;

    const dedupeKey = cleaned.toLowerCase();
    if (seen.has(dedupeKey)) continue;

    if (relevanceFilter && keywords.length > 0) {
      const lower = cleaned.toLowerCase();
      // Keep a line if it mentions any subject keyword, OR it's a substantial prose sentence
      // (long lines are usually real descriptive content worth keeping even without a keyword hit).
      const relevant = keywords.some((k) => lower.includes(k)) || cleaned.length > 160;
      if (!relevant) continue;
    }

    seen.add(dedupeKey);
    kept.push(cleaned);
    total += cleaned.length + 1;
    if (total >= maxChars) break;
  }

  return kept.join("\n").slice(0, maxChars);
}
