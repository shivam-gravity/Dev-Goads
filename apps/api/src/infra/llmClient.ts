import * as groq from "./groqClient.js";
import * as mistral from "./mistralClient.js";
import * as llmRouter from "./llmRouter.js";
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
 * Two capabilities OpenAI had that neither Groq nor Mistral replace:
 *  - Live web search: OpenAI's gpt-4o-search-preview was a hosted server-side search tool,
 *    not a model capability — nothing here replaces it. runWebSearch below always
 *    degrades to "no live search," exactly like the old contract did when
 *    OPENAI_API_KEY was unset, so every existing caller's fallback path is unchanged.
 *  - Image generation: gpt-image-1 has no Groq/Mistral equivalent either — see
 *    modules/generation/imageProvider.ts, which now always uses MockImageProvider.
 * Embeddings (Research Memory / RAG) DO have a replacement: Mistral's mistral-embed.
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

/** Always returns an empty result — see this file's doc comment on why no provider here
 * replaces OpenAI's hosted web search. Kept as a function (not deleted) so
 * research/providers/support.ts's webSearchThenStructure and the handful of Intelligence
 * Engines that call this directly don't need their own call sites rewritten, only this
 * implementation. */
export async function runWebSearch(_prompt: string): Promise<WebSearchOutcome> {
  return { narrative: "", citations: [], searchesUsed: 0 };
}

/** mistral-embed when MISTRAL_API_KEY is configured, else throws — same "not configured"
 * contract openaiClient.ts's createEmbedding had, so MemoryCoordinator.ts's existing
 * try/catch around this call needs no changes. */
export async function createEmbedding(text: string): Promise<number[]> {
  const embedding = await mistral.createEmbedding(text);
  if (!embedding) throw new Error("MISTRAL_API_KEY is not set (or Mistral returned no embedding)");
  return embedding;
}
