import OpenAI from "openai";
import { computeChatCostUsd, computeEmbeddingCostUsd, computeSearchCostUsd, isOpenAIBudgetExceeded, recordOpenAISpend } from "./openaiBudget.js";
import { recordTokens } from "./tokenMeter.js";

export const openai = process.env.OPENAI_API_KEY ? new OpenAI() : null;

// Shared by every exported call below — once this month's tracked spend hits the cap,
// OpenAI is treated exactly like "no API key configured" (see openaiBudget.ts for why: it
// caps this app's own draw against an OpenAI account shared with other, unrelated
// projects). Every existing caller already tolerates this thrown-error shape (the same one
// `if (!openai)` produces), so no downstream fallback logic needed to change.
function assertBudgetAvailable(): void {
  if (isOpenAIBudgetExceeded()) throw new Error("OpenAI monthly budget exceeded — see infra/openaiBudget.ts");
}

const DEFAULT_MODEL = "gpt-4o";
const SEARCH_MODEL = "gpt-4o-search-preview";
const EMBEDDING_MODEL = "text-embedding-3-small";

export interface JsonSchemaTool {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Forces a single named tool call and returns its parsed arguments, or null if the model
 * didn't call it — the OpenAI function-calling equivalent of Anthropic's
 * `tool_choice: { type: "tool", name }` pattern this codebase was originally built around.
 * Callers decide whether a null result means "throw" or "fall back to a static default",
 * matching whatever their pre-migration Anthropic call site did.
 */
export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  if (!openai) throw new Error("OPENAI_API_KEY is not set");
  assertBudgetAvailable();

  const model = opts.model ?? DEFAULT_MODEL;
  const completion = await openai.chat.completions.create({
    model,
    max_tokens: opts.maxTokens,
    messages: [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      ...opts.messages,
    ],
    tools: [{ type: "function", function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.input_schema } }],
    tool_choice: { type: "function", function: { name: opts.tool.name } },
  });
  recordOpenAISpend(computeChatCostUsd(model, completion.usage));
  recordTokens({ provider: "openai", model, kind: "structured", inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 });

  const call = completion.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") return null;
  return JSON.parse(call.function.arguments) as T;
}

/** Plain chat completion, no tools — returns the assistant's text, or null if empty. */
export async function runText(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
}): Promise<string | null> {
  if (!openai) throw new Error("OPENAI_API_KEY is not set");
  assertBudgetAvailable();

  const model = opts.model ?? DEFAULT_MODEL;
  const completion = await openai.chat.completions.create({
    model,
    max_tokens: opts.maxTokens,
    messages: [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      ...opts.messages,
    ],
  });
  recordOpenAISpend(computeChatCostUsd(model, completion.usage));
  recordTokens({ provider: "openai", model, kind: "text", inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 });

  return completion.choices[0]?.message?.content ?? null;
}

export interface WebSearchCitation {
  url: string;
  title: string;
}

export interface WebSearchOutcome {
  narrative: string;
  citations: WebSearchCitation[];
  searchesUsed: number;
}

/**
 * Live web-search-backed completion via gpt-4o-search-preview, which performs its own
 * search(es) server-side and returns inline `url_citation` annotations — the OpenAI
 * analogue of Anthropic's server-side `web_search_20250305` tool. This model family
 * doesn't report how many individual searches it ran internally (no equivalent of
 * Anthropic's per-call max_uses/search-count), so searchesUsed is reported as 1 when any
 * citation came back, 0 otherwise — good enough for this codebase's only use of that
 * field (deciding whether to label a result "AI estimate" vs. citing real sources).
 */
export async function runWebSearch(prompt: string): Promise<WebSearchOutcome> {
  if (!openai) throw new Error("OPENAI_API_KEY is not set");
  assertBudgetAvailable();

  const completion = await openai.chat.completions.create({
    model: SEARCH_MODEL,
    messages: [{ role: "user", content: prompt }],
    // web_search_options isn't in this SDK version's ChatCompletionCreateParams typing yet;
    // the search-preview model still accepts it over the wire.
    ...({ web_search_options: {} } as unknown as object),
  } as OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming);
  recordOpenAISpend(computeSearchCostUsd(SEARCH_MODEL, completion.usage));
  recordTokens({ provider: "openai", model: SEARCH_MODEL, kind: "search", inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 });

  const message = completion.choices[0]?.message as unknown as { content?: string; annotations?: Array<{ type: string; url_citation?: { url: string; title?: string } }> };
  const narrative = message?.content ?? "";
  const citationsByUrl = new Map<string, WebSearchCitation>();
  for (const annotation of message?.annotations ?? []) {
    if (annotation.type === "url_citation" && annotation.url_citation) {
      citationsByUrl.set(annotation.url_citation.url, { url: annotation.url_citation.url, title: annotation.url_citation.title ?? annotation.url_citation.url });
    }
  }

  return { narrative: narrative.trim(), citations: [...citationsByUrl.values()], searchesUsed: citationsByUrl.size > 0 ? 1 : 0 };
}

/** text-embedding-3-small — 1536 dimensions, used by research/memory/ResearchMemoryStore.ts
 * for Research Memory / RAG retrieval (currently backing Competitor Intelligence). */
export async function createEmbedding(text: string): Promise<number[]> {
  if (!openai) throw new Error("OPENAI_API_KEY is not set");
  assertBudgetAvailable();

  const result = await openai.embeddings.create({ model: EMBEDDING_MODEL, input: text });
  recordOpenAISpend(computeEmbeddingCostUsd(EMBEDDING_MODEL, result.usage?.total_tokens));
  recordTokens({ provider: "openai", model: EMBEDDING_MODEL, kind: "embedding", inputTokens: result.usage?.total_tokens ?? 0, outputTokens: 0 });
  return result.data[0].embedding;
}
