import OpenAI from "openai";
import type { ChatMessage, JsonSchemaTool } from "./llmTypes.js";
import { recordTokens } from "./tokenMeter.js";
import { recordGlobalLlmUsage } from "./llmUsageBoundary.js";

// Ollama exposes an OpenAI-compatible endpoint, so the same SDK works unchanged — just a
// different baseURL and a throwaway API key (Ollama doesn't check it, but the SDK requires
// a non-empty string). Constructed unconditionally, unlike openaiClient.ts's `openai`
// (gated on OPENAI_API_KEY) — Ollama has no "configured or not" concept the way a hosted
// API with a real key does; if nothing is listening at OLLAMA_BASE_URL, the call itself
// just fails, which llmRouter.ts's fallback-to-OpenAI wrapping already handles.
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
const OLLAMA_DEFAULT_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";
const ollama = new OpenAI({ baseURL: OLLAMA_BASE_URL, apiKey: "ollama" });

// Caps how many requests run concurrently against the one local Ollama instance — without
// this, assigning several concurrently-running agents/providers to Ollama would all hit
// the same CPU-bound model at once and thrash rather than queue. Mirrors the Playwright
// page-concurrency cap in apps/scraper-service/src/scraping/browser.ts.
const MAX_CONCURRENT = Number(process.env.OLLAMA_MAX_CONCURRENT ?? 2);
let active = 0;
const waiters: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return;
  }
  await new Promise<void>((resolve) => waiters.push(resolve));
  active += 1;
}

function releaseSlot(): void {
  active -= 1;
  const next = waiters.shift();
  if (next) next();
}

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  await acquireSlot();
  try {
    return await fn();
  } finally {
    releaseSlot();
  }
}

export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  return withSlot(async () => {
    const completion = await ollama.chat.completions.create({
      model: opts.model ?? OLLAMA_DEFAULT_MODEL,
      max_tokens: opts.maxTokens,
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        ...opts.messages,
      ],
      tools: [{ type: "function", function: { name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.input_schema } }],
      tool_choice: { type: "function", function: { name: opts.tool.name } },
    });
    recordTokens({ provider: "ollama", model: opts.model ?? OLLAMA_DEFAULT_MODEL, kind: "structured", inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 });
    recordGlobalLlmUsage((completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0));

    const call = completion.choices[0]?.message?.tool_calls?.[0];
    if (!call || call.type !== "function") return null;
    return JSON.parse(call.function.arguments) as T;
  });
}

/** Plain chat completion, no tools — returns the assistant's text, or null if empty. */
export async function runText(opts: { model?: string; maxTokens: number; system?: string; messages: ChatMessage[] }): Promise<string | null> {
  return withSlot(async () => {
    const completion = await ollama.chat.completions.create({
      model: opts.model ?? OLLAMA_DEFAULT_MODEL,
      max_tokens: opts.maxTokens,
      messages: [
        ...(opts.system ? [{ role: "system" as const, content: opts.system }] : []),
        ...opts.messages,
      ],
    });
    recordTokens({ provider: "ollama", model: opts.model ?? OLLAMA_DEFAULT_MODEL, kind: "text", inputTokens: completion.usage?.prompt_tokens ?? 0, outputTokens: completion.usage?.completion_tokens ?? 0 });
    recordGlobalLlmUsage((completion.usage?.prompt_tokens ?? 0) + (completion.usage?.completion_tokens ?? 0));

    return completion.choices[0]?.message?.content ?? null;
  });
}
