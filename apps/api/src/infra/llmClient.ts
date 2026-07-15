import * as groq from "./groqClient.js";
import * as mistral from "./mistralClient.js";
import * as llmRouter from "./llmRouter.js";
import * as searchRouter from "./searchRouter.js";
import { resolveSearchTask } from "./searchTaskConfig.js";
import type { ChatMessage, JsonSchemaTool, WebSearchOutcome } from "./llmTypes.js";

export type { ChatMessage, JsonSchemaTool, WebSearchOutcome };

/**
 * Compatibility facade for the ~20 call sites (agents/support.ts, several modules/*
 * services, several research/* engines) that predate llmRouter.ts's per-task provider
 * routing and always called OpenAI's chat/text/search/embedding functions directly, with
 * no task-specific model assignment. Rather than migrate every one of those onto
 * llmRouter.ts + llmTaskConfig.ts (a much larger, separately-scoped change), this module
 * is a drop-in replacement for the old infra/openaiClient.ts: same function names/shapes,
 * backed by Groq (the new default text-generation provider — fast, hosted, a genuinely
 * free tier) instead of OpenAI.
 *
 * runStructured/runText route through llmRouter.ts with a fixed "groq" assignment rather
 * than calling groqClient directly — every one of these ~20 call sites gets llmRouter's
 * fallback chain (groq -> mistral -> google) for free this way, no call-site changes
 * needed. Before this, a Groq failure here (e.g. its daily token quota exhausted) had
 * nowhere to fall back to at all — see modules/onboarding/analysis.ts's fact-extraction
 * call, which failed outright with a Groq 429 while router-based callers doing the exact
 * same kind of work already degraded gracefully to Mistral.
 *
 * One capability OpenAI had that neither Groq nor Mistral replace:
 *  - Image generation: gpt-image-1 has no Groq/Mistral equivalent either — see
 *    modules/generation/imageProvider.ts, which now always uses MockImageProvider.
 * Embeddings (Research Memory / RAG) DO have a replacement: Mistral's mistral-embed.
 * Live web search DOES have a replacement now too — see runWebSearch below.
 */

export const llm = groq.isGroqConfigured();

export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  if (!llm) throw new Error("GROQ_API_KEY is not set");
  const { model, ...rest } = opts;
  const result = await llmRouter.runStructured<T>({ provider: "groq", model: model ?? groq.GROQ_DEFAULT_MODEL }, rest);
  return result.data;
}

/** Plain chat completion, no tools — returns the assistant's text, or null if empty. */
export async function runText(opts: { model?: string; maxTokens: number; system?: string; messages: ChatMessage[] }): Promise<string | null> {
  if (!llm) throw new Error("GROQ_API_KEY is not set");
  const { model, ...rest } = opts;
  const result = await llmRouter.runText({ provider: "groq", model: model ?? groq.GROQ_DEFAULT_MODEL }, rest);
  return result.data;
}

/**
 * Backed by searchRouter.ts's tavily -> serper -> searxng chain (searchTaskConfig.ts
 * assigns this the "web-research" task, resolving to Tavily by default). Previously backed
 * by Firecrawl's /search — replaced after that account hit its credit limit. Groq's
 * compound-beta model (tried live: rejected with an opaque "Request Entity Too Large" on
 * this account/tier) and Gemini's Google Search grounding (tried live: this key's
 * free-tier request quota is 0) were both ruled out earlier in that same search, before
 * Firecrawl itself ran dry too.
 *
 * `prompt` here is a full instructional research sentence (e.g. "Research the main named
 * competitors of the business at X..."), not a short keyword query like buildSearchQuery()
 * produces for SearchRankingProvider's dedicated search-ranking task — passed through
 * as-is rather than distilled into a shorter query first, since that would need an extra
 * LLM call per search just to shorten a prompt that's already only one or two sentences.
 * Tavily in particular is built to handle natural-language queries well, so this matters
 * less here than it would for a bare keyword-search engine.
 *
 * Degrades to the same empty result on any outage (no vendor configured, every tier in the
 * chain failed/empty) that the old permanent no-op always returned — every existing
 * caller's fallback path (support.ts's webSearchThenStructure, the Intelligence Engines'
 * own runWebSearch calls) already handles that shape and needs no changes.
 */
export async function runWebSearch(prompt: string): Promise<WebSearchOutcome> {
  const assignment = resolveSearchTask("web-research");
  const { results, searchesUsed } = await searchRouter.runSearch(assignment, prompt, { maxResults: 5 });
  if (results.length === 0) return { narrative: "", citations: [], searchesUsed: 0 };

  const narrative = results.map((r) => `${r.title}\n${r.snippet}`).join("\n\n");
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
