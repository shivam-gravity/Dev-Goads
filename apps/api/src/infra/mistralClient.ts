import type { ChatMessage, JsonSchemaTool } from "./llmTypes.js";
import { recordTokens } from "./tokenMeter.js";
import { assertGlobalLlmUsageAvailable, recordGlobalLlmUsage } from "./llmUsageBoundary.js";
import { logger } from "../modules/logger/logger.js";

// Plain fetch (no SDK dependency added) against Mistral's own API, matching the shape
// documented at docs.mistral.ai/api — closely OpenAI-compatible (same messages/tools
// shape, tool_choice-by-name object forcing) but NOT run through the OpenAI SDK the way
// Groq/Ollama are, since Mistral's baseURL isn't a drop-in OpenAI-compatible endpoint the
// SDK's client understands out of the box (some response fields differ).
//
// Live-verified 2026-07-15 against api.mistral.ai/v1/chat/completions (forced tool call)
// and /v1/embeddings (mistral-embed) with a real key — both match the shapes below exactly.
// An earlier key tried when this file was first written 401'd on both endpoints; that was
// the wrong/stale key, not a bug in this client.
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;
const MISTRAL_BASE_URL = "https://api.mistral.ai/v1";
const MISTRAL_DEFAULT_MODEL = process.env.MISTRAL_MODEL ?? "mistral-small-latest";
const MISTRAL_EMBEDDING_MODEL = "mistral-embed";

interface MistralChatResponse {
  choices: { message: { content?: string; tool_calls?: { function: { name: string; arguments: string } }[] } }[];
  usage?: { prompt_tokens: number; completion_tokens: number };
}

async function chatCompletion(opts: {
  model: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tools?: { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }[];
  tool_choice?: { type: "function"; function: { name: string } };
}): Promise<MistralChatResponse | null> {
  if (!MISTRAL_API_KEY) return null;
  assertGlobalLlmUsageAvailable();

  const res = await fetch(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MISTRAL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [...(opts.system ? [{ role: "system" as const, content: opts.system }] : []), ...opts.messages],
      ...(opts.tools ? { tools: opts.tools, tool_choice: opts.tool_choice } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Mistral chat completion failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as MistralChatResponse;
}

export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  const model = opts.model ?? MISTRAL_DEFAULT_MODEL;
  const response = await chatCompletion({
    model,
    maxTokens: opts.maxTokens,
    system: opts.system,
    messages: opts.messages,
    tools: [{ type: "function", function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.input_schema } }],
    tool_choice: { type: "function", function: { name: opts.tool.name } },
  });
  if (!response) return null;
  recordTokens({ provider: "mistral", model, kind: "structured", inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 });
  recordGlobalLlmUsage((response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0));

  const call = response.choices[0]?.message?.tool_calls?.[0];
  if (!call) return null;
  try {
    return JSON.parse(call.function.arguments) as T;
  } catch (err) {
    logger.warn("mistralClient: tool-call arguments were not valid JSON (likely truncated by max_tokens)", err);
    return null;
  }
}

export async function runText(opts: { model?: string; maxTokens: number; system?: string; messages: ChatMessage[] }): Promise<string | null> {
  const model = opts.model ?? MISTRAL_DEFAULT_MODEL;
  const response = await chatCompletion({ model, maxTokens: opts.maxTokens, system: opts.system, messages: opts.messages });
  if (!response) return null;
  recordTokens({ provider: "mistral", model, kind: "text", inputTokens: response.usage?.prompt_tokens ?? 0, outputTokens: response.usage?.completion_tokens ?? 0 });
  recordGlobalLlmUsage((response.usage?.prompt_tokens ?? 0) + (response.usage?.completion_tokens ?? 0));

  return response.choices[0]?.message?.content ?? null;
}

interface MistralEmbeddingResponse {
  data: { embedding: number[] }[];
  usage?: { total_tokens: number };
}

/** mistral-embed — 1024 dimensions. Replaces OpenAI's text-embedding-3-small for Research
 * Memory / RAG (research/memory/MemoryCoordinator.ts). Different dimensionality than the
 * old OpenAI embeddings (1536) — any pre-existing embedded rows are NOT comparable against
 * new queries (cosine similarity over mismatched-length vectors is meaningless); those old
 * rows will simply never match anything going forward rather than erroring, since
 * ResearchMemoryStore's similarity search skips rows whose vector length doesn't match. */
export async function createEmbedding(text: string): Promise<number[] | null> {
  if (!MISTRAL_API_KEY) return null;
  assertGlobalLlmUsageAvailable();

  const res = await fetch(`${MISTRAL_BASE_URL}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MISTRAL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MISTRAL_EMBEDDING_MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Mistral embedding failed (${res.status}): ${await res.text()}`);
  const json = (await res.json()) as MistralEmbeddingResponse;
  recordTokens({ provider: "mistral", model: MISTRAL_EMBEDDING_MODEL, kind: "embedding", inputTokens: json.usage?.total_tokens ?? 0, outputTokens: 0 });
  recordGlobalLlmUsage(json.usage?.total_tokens ?? 0);
  return json.data[0]?.embedding ?? null;
}

export function isMistralConfigured(): boolean {
  return MISTRAL_API_KEY !== undefined && MISTRAL_API_KEY.length > 0;
}
