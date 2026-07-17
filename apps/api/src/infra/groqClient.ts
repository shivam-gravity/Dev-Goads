import OpenAI from "openai";
import type { ChatMessage, JsonSchemaTool } from "./llmTypes.js";
import { recordTokens } from "./tokenMeter.js";
import { assertGlobalLlmUsageAvailable, recordGlobalLlmUsage } from "./llmUsageBoundary.js";
import { dynamicFetch } from "./dynamicFetch.js";
import { logger } from "../modules/logger/logger.js";

// Groq's API is OpenAI-compatible (same chat.completions.create shape, including
// tool_choice-by-name forcing) — confirmed live against api.groq.com before this file was
// written, so the OpenAI SDK works unchanged pointed at Groq's baseURL, same trick
// ollamaClient.ts uses for the local model. This is now the platform's default/reliable
// text-generation backend (replacing OpenAI): fast hosted inference, a genuinely free tier,
// no local model to keep running.
const groq = process.env.GROQ_API_KEY ? new OpenAI({ apiKey: process.env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1", fetch: dynamicFetch }) : null;
export const GROQ_DEFAULT_MODEL = process.env.GROQ_MODEL ?? "llama-3.3-70b-versatile";

export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  if (!groq) return null;
  assertGlobalLlmUsageAvailable();

  const model = opts.model ?? GROQ_DEFAULT_MODEL;
  const completion = await groq.chat.completions.create({
    model,
    max_tokens: opts.maxTokens,
    messages: [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      ...opts.messages,
    ],
    tools: [{ type: "function", function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.input_schema } }],
    tool_choice: { type: "function", function: { name: opts.tool.name } },
  });
  recordTokens({ provider: "groq", model, kind: "structured", inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 });
  recordGlobalLlmUsage((completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0));

  const call = completion.choices[0]?.message?.tool_calls?.[0];
  if (!call || call.type !== "function") return null;
  try {
    return JSON.parse(call.function.arguments) as T;
  } catch (err) {
    // The model can return truncated tool-call arguments if it hits max_tokens mid-object
    // (finish_reason "length") — a malformed response, not a network/API failure, so treat
    // it the same as "didn't call the tool": null, letting llmRouter's fallback chain move
    // to the next provider instead of throwing an uncaught parse error.
    logger.warn("groqClient: tool-call arguments were not valid JSON (likely truncated by max_tokens)", err);
    return null;
  }
}

/** Plain chat completion, no tools — returns the assistant's text, or null if empty/not configured. */
export async function runText(opts: { model?: string; maxTokens: number; system?: string; messages: ChatMessage[] }): Promise<string | null> {
  if (!groq) return null;
  assertGlobalLlmUsageAvailable();

  const model = opts.model ?? GROQ_DEFAULT_MODEL;
  const completion = await groq.chat.completions.create({
    model,
    max_tokens: opts.maxTokens,
    messages: [
      ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
      ...opts.messages,
    ],
  });
  recordTokens({ provider: "groq", model, kind: "text", inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 });
  recordGlobalLlmUsage((completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0));

  return completion.choices[0]?.message?.content ?? null;
}

export function isGroqConfigured(): boolean {
  return groq !== null;
}

/**
 * Streaming chat completion — invokes the onChunk callback with each token as it arrives,
 * then returns the full assembled text. Used by the SSE chat endpoint for real-time
 * token-by-token delivery to the browser.
 */
export async function streamChat(
  system: string,
  messages: ChatMessage[],
  onChunk: (chunk: string) => void,
): Promise<string> {
  if (!groq) throw new Error("GROQ_API_KEY is not set");
  assertGlobalLlmUsageAvailable();

  const model = GROQ_DEFAULT_MODEL;
  const stream = await groq.chat.completions.create({
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

  recordTokens({ provider: "groq", model, kind: "text", inputTokens: 0, outputTokens: fullText.length / 4 });
  recordGlobalLlmUsage(Math.ceil(fullText.length / 4));
  return fullText;
}
