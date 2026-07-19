import OpenAI from "openai";
import type { ChatMessage, JsonSchemaTool } from "./llmTypes.js";
import { recordTokens } from "./tokenMeter.js";
import { assertGlobalLlmUsageAvailable, recordGlobalLlmUsage } from "./llmUsageBoundary.js";
import { dynamicFetch } from "./dynamicFetch.js";
import { logger } from "../modules/logger/logger.js";

// OpenRouter is an OpenAI-compatible aggregator (one API key fronting many model providers —
// free-tier Llama/Qwen/DeepSeek plus paid GPT/Claude/Gemini), so the OpenAI SDK works unchanged
// pointed at its baseURL, exactly the trick groqClient.ts/ollamaClient.ts use. This REPLACES Groq
// as the platform's primary/default text-generation backend: Groq's single-key daily token quota
// was the recurring bottleneck (every task defaulting to it degraded at once when it hit the cap);
// OpenRouter spreads across many upstreams and lets the model be swapped via env with no code
// change. The default model is a free tier; set OPENROUTER_MODEL to a paid model for higher quality.
// Free-tier models (the `:free` suffix) share a heavily rate-limited pool and answer a burst
// with HTTP 429. The research pipeline fans out ~20 providers, most doing a dual call, so the
// free pool sees far more than its per-second cap at once — which (with the SDK's default of
// just 2 retries and no concurrency limit) made ~half the calls exhaust retries and time out at
// 45s, degrading the run to low-confidence/confabulated output. Two guards fix that WITHOUT
// paying for a paid model:
//   1) maxRetries below — the OpenAI SDK retries 429/5xx with exponential backoff and honors the
//      server's Retry-After header, so a throttled call waits and succeeds instead of failing.
//   2) a concurrency semaphore (acquireSlot/releaseSlot) so we never fire more than
//      OPENROUTER_MAX_CONCURRENCY requests at once — throttle at the SOURCE rather than
//      stampeding the free pool and then retrying en masse.
const OPENROUTER_MAX_RETRIES = Math.max(0, Number(process.env.OPENROUTER_MAX_RETRIES ?? 6));

const openRouter = process.env.OPENROUTER_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: "https://openrouter.ai/api/v1",
      fetch: dynamicFetch,
      // Free-tier 429s are transient — let the SDK ride them out (it backs off + honors
      // Retry-After) instead of the default 2 tries giving up under a burst.
      maxRetries: OPENROUTER_MAX_RETRIES,
      // A single free-tier call can wait through several Retry-After backoffs; give it room.
      timeout: 90_000,
      // OpenRouter uses these for its dashboard attribution/ranking; harmless if the app isn't listed.
      defaultHeaders: {
        "HTTP-Referer": process.env.OPENROUTER_SITE_URL ?? "https://polluxa.local",
        "X-Title": process.env.OPENROUTER_SITE_NAME ?? "Polluxa CRM Ads",
      },
    })
  : null;

export const OPENROUTER_DEFAULT_MODEL = process.env.OPENROUTER_MODEL ?? "meta-llama/llama-3.3-70b-instruct:free";

// Cap concurrent in-flight OpenRouter calls so a fan-out burst can't stampede the free pool
// (see the doc comment above). Low by default because the free tier's per-second ceiling is
// low; tune via OPENROUTER_MAX_CONCURRENCY. Same pattern as crawl4aiClient/mistralClient.
const OPENROUTER_MAX_CONCURRENCY = Math.max(1, Number(process.env.OPENROUTER_MAX_CONCURRENCY ?? 3));
let inFlight = 0;
const waiters: (() => void)[] = [];

async function acquireSlot(): Promise<void> {
  if (inFlight < OPENROUTER_MAX_CONCURRENCY) {
    inFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  inFlight += 1;
}

function releaseSlot(): void {
  inFlight -= 1;
  const next = waiters.shift();
  if (next) next();
}

export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  if (!openRouter) return null;
  assertGlobalLlmUsageAvailable();

  const model = opts.model ?? OPENROUTER_DEFAULT_MODEL;
  await acquireSlot();
  let completion;
  try {
    completion = await openRouter.chat.completions.create({
      model,
      max_tokens: opts.maxTokens,
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        ...opts.messages,
      ],
      tools: [{ type: "function", function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.input_schema } }],
      tool_choice: { type: "function", function: { name: opts.tool.name } },
    });
  } finally {
    releaseSlot();
  }
  recordTokens({ provider: "openrouter", model, kind: "structured", inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 });
  recordGlobalLlmUsage((completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0));

  const call = completion.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") return null;
  try {
    return JSON.parse(call.function.arguments) as T;
  } catch (err) {
    // Truncated tool-call arguments (finish_reason "length") are a malformed response, not a
    // network/API failure — treat as "didn't call the tool" (null) so llmRouter's fallback chain
    // moves to the next provider instead of throwing an uncaught parse error.
    logger.warn("openRouterClient: tool-call arguments were not valid JSON (likely truncated by max_tokens)", err);
    return null;
  }
}

/** Plain chat completion, no tools — returns the assistant's text, or null if empty/not configured. */
export async function runText(opts: { model?: string; maxTokens: number; system?: string; messages: ChatMessage[] }): Promise<string | null> {
  if (!openRouter) return null;
  assertGlobalLlmUsageAvailable();

  const model = opts.model ?? OPENROUTER_DEFAULT_MODEL;
  await acquireSlot();
  let completion;
  try {
    completion = await openRouter.chat.completions.create({
      model,
      max_tokens: opts.maxTokens,
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        ...opts.messages,
      ],
    });
  } finally {
    releaseSlot();
  }
  recordTokens({ provider: "openrouter", model, kind: "text", inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 });
  recordGlobalLlmUsage((completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0));

  return completion.choices[0]?.message?.content ?? null;
}

export function isOpenRouterConfigured(): boolean {
  return openRouter !== null;
}

/**
 * Streaming chat completion — invokes onChunk with each token as it arrives, then returns the
 * full assembled text. Used by the SSE chat endpoint for real-time token-by-token delivery.
 */
export async function streamChat(
  system: string,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
): Promise<string> {
  if (!openRouter) throw new Error("OPENROUTER_API_KEY is not set");
  assertGlobalLlmUsageAvailable();

  const model = OPENROUTER_DEFAULT_MODEL;
  const stream = await openRouter.chat.completions.create({
    model,
    max_tokens: 1024,
    stream: true,
    messages: [
      { role: "system" as const, content: system },
      ...messages,
    ],
  });

  let fullText = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      fullText += delta;
      onChunk(delta);
    }
  }

  recordTokens({ provider: "openrouter", model, kind: "text", inputTokens: 0, outputTokens: fullText.length / 4 });
  recordGlobalLlmUsage(Math.ceil(fullText.length / 4));
  return fullText;
}
