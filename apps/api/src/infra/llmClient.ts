import * as openRouter from "./openRouterClient.js";
import * as mistral from "./mistralClient.js";
import * as llmRouter from "./llmRouter.js";
import * as searchRouter from "./searchRouter.js";
import { resolveSearchTask } from "./searchTaskConfig.js";
import { crawl4aiScrape } from "./crawl4aiClient.js";
import { refineContent } from "./contentRefiner.js";
import type { ChatMessage, JsonSchemaTool, WebSearchOutcome } from "./llmTypes.js";

export type { ChatMessage, JsonSchemaTool, WebSearchOutcome };

/**
 * Compatibility facade for the ~20 call sites (agents/support.ts, several modules/*
 * services, several research/* engines) that predate llmRouter.ts's per-task provider
 * routing and always called OpenAI's chat/text/search/embedding functions directly, with
 * no task-specific model assignment. Rather than migrate every one of those onto
 * llmRouter.ts + llmTaskConfig.ts (a much larger, separately-scoped change), this module
 * is a drop-in replacement for the old infra/openaiClient.ts: same function names/shapes,
 * backed by OpenRouter (the new default text-generation provider — an OpenAI-compatible
 * aggregator with many upstream models behind one key) instead of OpenAI.
 *
 * runStructured/runText route through llmRouter.ts with a fixed "openrouter" assignment rather
 * than calling openRouterClient directly — every one of these ~20 call sites gets llmRouter's
 * fallback chain (openrouter -> mistral -> google) for free this way, no call-site changes
 * needed. Before this, the default provider failing (e.g. a daily token quota exhausted) had
 * nowhere to fall back to at all — see modules/onboarding/analysis.ts's fact-extraction call,
 * which failed outright with a 429 while router-based callers doing the exact same kind of work
 * already degraded gracefully to Mistral.
 *
 * One capability OpenAI had that neither OpenRouter's default free model nor Mistral replace here:
 *  - Image generation: gpt-image-1 has no equivalent wired — see
 *    modules/generation/imageProvider.ts, which now always uses MockImageProvider.
 * Embeddings (Research Memory / RAG) DO have a replacement: Mistral's mistral-embed.
 * Live web search DOES have a replacement now too — see runWebSearch below.
 */

export const llm = openRouter.isOpenRouterConfigured();

export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  if (!llm) throw new Error("OPENROUTER_API_KEY is not set");
  const { model, ...rest } = opts;
  const result = await llmRouter.runStructured<T>({ provider: "openrouter", model: model ?? openRouter.OPENROUTER_DEFAULT_MODEL }, rest);
  return result.data;
}

/** Plain chat completion, no tools — returns the assistant's text, or null if empty. */
export async function runText(opts: { model?: string; maxTokens: number; system?: string; messages: ChatMessage[] }): Promise<string | null> {
  if (!llm) throw new Error("OPENROUTER_API_KEY is not set");
  const { model, ...rest } = opts;
  const result = await llmRouter.runText({ provider: "openrouter", model: model ?? openRouter.OPENROUTER_DEFAULT_MODEL }, rest);
  return result.data;
}

/**
 * SearXNG search (searchTaskConfig.ts assigns this the "web-research" task) followed by a
 * crawl4ai content-enrichment pass. This two-stage design matters for research QUALITY:
 * SearXNG returns only a one-line result blurb per hit (a search-engine snippet), which is far
 * thinner grounding than the paragraph of extracted page text Tavily used to return in this
 * same field. To restore deep grounding, the top results' URLs are crawled with crawl4ai (self-
 * hosted, no per-call quota) IN PARALLEL, and each hit's narrative uses the real page content
 * when the crawl succeeds, falling back to the SearXNG snippet when it doesn't. So a hit's
 * grounding is: full page markdown (best) -> SearXNG snippet (fine) -> title only (worst).
 *
 * `prompt` here is a full instructional research sentence (e.g. "Research the main named
 * competitors of the business at X..."), passed to SearXNG as-is rather than distilled into a
 * shorter query first (that would cost an extra LLM call per search on an already-short prompt).
 *
 * Degrades to the same empty result on any outage (SearXNG unreachable / no results) the old
 * no-op returned; enrichment failing (crawl4ai down) never blocks the search — every caller's
 * fallback path (support.ts's webSearchThenStructure, the Intelligence Engines' own
 * runWebSearch calls) already handles the empty shape and needs no changes.
 */
const ENRICH_TOP_N = 4; // crawl this many of the top hits for full content — balances grounding depth against latency
const REFINED_CHARS_PER_HIT = 1800; // post-refine per-hit budget: dense, de-noised text, not a whole page dump

export async function runWebSearch(prompt: string): Promise<WebSearchOutcome> {
  const assignment = resolveSearchTask("web-research");
  const { results, searchesUsed } = await searchRouter.runSearch(assignment, prompt, { maxResults: 5 });
  if (results.length === 0) return { narrative: "", citations: [], searchesUsed: 0 };

  // Enrich the top hits with full page content, all concurrently, then REFINE each crawl down
  // to only the query-relevant, boilerplate-stripped passages (contentRefiner — no LLM, pure
  // string work). This is the token-cost lever: a raw crawl is mostly nav/footer/cookie/link
  // noise; refining sends the reasoning model dense signal instead of a whole rendered page,
  // which matters doubly now that deep-research tasks run dual (Groq+Mistral) and pay per call
  // on both. Each enrichment failing (crawl4ai down, page blocked, timeout) resolves to null and
  // falls back to the SearXNG snippet — the search result is never lost because a crawl missed.
  const toEnrich = results.slice(0, ENRICH_TOP_N);
  const enriched = await Promise.all(
    toEnrich.map(async (r) => {
      try {
        const { data } = await crawl4aiScrape(r.url, ["markdown"]);
        const md = data?.markdown?.trim();
        if (!md) return null;
        const refined = refineContent(md, prompt, { maxChars: REFINED_CHARS_PER_HIT });
        return refined || null;
      } catch {
        return null;
      }
    })
  );

  const narrative = results
    .map((r, i) => {
      const body = (i < enriched.length && enriched[i]) || r.snippet || "";
      return `${r.title}\n${body}`;
    })
    .join("\n\n");
  const citations = results.map((r) => ({ url: r.url, title: r.title }));
  return { narrative, citations, searchesUsed };
}

/** mistral-embed when MISTRAL_API_KEY is configured, else throws — same "not configured"
 * contract openaiClient.ts's createEmbedding had, so MemoryCoordinator.ts's existing
 * try/catch around this call needs no changes. */
export async function createEmbedding(text: string): Promise<number[]> {
  const embedding = await mistral.createEmbedding(text);
  if (!embedding) throw new Error("MISTRAL_API_KEY is not set (or Mistral returned no embedding)");
  return embedding;
}
