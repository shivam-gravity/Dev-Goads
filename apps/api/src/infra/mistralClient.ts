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

// Mistral's free tier throttles to a low requests-per-second cap and answers a burst with HTTP
// 429 (a TRANSIENT rate limit that clears in seconds — NOT a hard quota). The research pipeline
// fans out ~20 providers, each doing a dual (Groq+Mistral) call, so Mistral sees a burst far
// over its per-second cap all at once. Two guards below tame that:
//   1) a concurrency limiter so we never fire more than MISTRAL_MAX_CONCURRENCY requests at once
//      (throttle at the SOURCE instead of stampeding then retrying), and
//   2) retry-with-backoff on 429/5xx (honoring Retry-After) so a request that does get throttled
//      waits and succeeds instead of the leg failing instantly (the old behavior — throw on any
//      non-ok, which made Mistral look "exhausted" when it was only briefly rate-limited).
const MISTRAL_MAX_CONCURRENCY = Math.max(1, Number(process.env.MISTRAL_MAX_CONCURRENCY ?? 2));
const MISTRAL_MAX_RETRIES = Math.max(0, Number(process.env.MISTRAL_MAX_RETRIES ?? 4));
const MISTRAL_BASE_BACKOFF_MS = 500;
const MISTRAL_MAX_BACKOFF_MS = 8000;

let mistralInFlight = 0;
const mistralWaiters: (() => void)[] = [];

async function acquireMistralSlot(): Promise<void> {
  if (mistralInFlight < MISTRAL_MAX_CONCURRENCY) {
    mistralInFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => mistralWaiters.push(resolve));
  mistralInFlight += 1;
}

function releaseMistralSlot(): void {
  mistralInFlight -= 1;
  const next = mistralWaiters.shift();
  if (next) next();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Backoff for retry attempt N (0-based): honor a server-provided Retry-After (seconds) when
 * present, else exponential (500ms, 1s, 2s, 4s…) capped, with jitter to avoid a thundering-herd
 * of all the fanned-out requests retrying in lockstep. */
function backoffMs(attempt: number, retryAfterHeader: string | null): number {
  const retryAfterSec = retryAfterHeader ? Number(retryAfterHeader) : NaN;
  if (Number.isFinite(retryAfterSec) && retryAfterSec > 0) return Math.min(retryAfterSec * 1000, MISTRAL_MAX_BACKOFF_MS);
  const expo = Math.min(MISTRAL_BASE_BACKOFF_MS * 2 ** attempt, MISTRAL_MAX_BACKOFF_MS);
  return expo + Math.floor((expo / 2) * ((mistralInFlight % 7) / 7)); // deterministic jitter (no Math.random in this codebase)
}

/** Fetch with the concurrency slot held, retrying 429 (rate limit) and 5xx (transient server)
 * with backoff. Non-retryable 4xx (401/400/404) throw immediately — retrying those is pointless.
 * Returns the successful Response; throws only after exhausting retries or on a non-retryable status. */
async function fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
  await acquireMistralSlot();
  try {
    let lastErrText = "";
    for (let attempt = 0; attempt <= MISTRAL_MAX_RETRIES; attempt++) {
      const res = await fetch(url, init);
      if (res.ok) return res;

      const retryable = res.status === 429 || (res.status >= 500 && res.status < 600);
      if (!retryable || attempt === MISTRAL_MAX_RETRIES) {
        throw new Error(`Mistral request failed (${res.status}): ${await res.text()}`);
      }
      lastErrText = `${res.status}`;
      const wait = backoffMs(attempt, res.headers.get("retry-after"));
      logger.warn(`mistralClient: ${lastErrText} (rate-limited/transient) — retrying in ${wait}ms (attempt ${attempt + 1}/${MISTRAL_MAX_RETRIES})`);
      await sleep(wait);
    }
    // Unreachable (loop either returns or throws), but satisfies the type checker.
    throw new Error(`Mistral request failed after retries: ${lastErrText}`);
  } finally {
    releaseMistralSlot();
  }
}

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

  const res = await fetchWithRetry(`${MISTRAL_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MISTRAL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: opts.maxTokens,
      messages: [...(opts.system ? [{ role: "system" as const, content: opts.system }] : []), ...opts.messages],
      ...(opts.tools ? { tools: opts.tools, tool_choice: opts.tool_choice } : {}),
    }),
  });
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

  const res = await fetchWithRetry(`${MISTRAL_BASE_URL}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MISTRAL_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: MISTRAL_EMBEDDING_MODEL, input: text }),
  });
  const json = (await res.json()) as MistralEmbeddingResponse;
  recordTokens({ provider: "mistral", model: MISTRAL_EMBEDDING_MODEL, kind: "embedding", inputTokens: json.usage?.total_tokens ?? 0, outputTokens: 0 });
  recordGlobalLlmUsage(json.usage?.total_tokens ?? 0);
  return json.data[0]?.embedding ?? null;
}

export function isMistralConfigured(): boolean {
  return MISTRAL_API_KEY !== undefined && MISTRAL_API_KEY.length > 0;
}
