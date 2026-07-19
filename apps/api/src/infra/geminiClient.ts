import { FunctionCallingConfigMode, GoogleGenAI } from "@google/genai";
import type { ChatMessage, JsonSchemaTool } from "./llmTypes.js";
import { recordTokens } from "./tokenMeter.js";
import { recordGlobalLlmUsage } from "./llmUsageBoundary.js";
import { logger } from "../modules/logger/logger.js";

// Gated behind GEMINI_API_KEY exactly like the other two non-OpenAI clients — no key
// means every call below degrades to a clean `null`, and llmRouter.ts's fallback wrapping
// routes the task to another provider instead. @google/genai (not the deprecated
// @google/generative-ai, which Google retired November 30, 2025) is the current, GA SDK.
//
// Gemini is now the PRIMARY workhorse (LLM_PRIMARY=gemini). Its AI Studio free tier is
// per-minute rate-limited just like Mistral (verified live 2026-07-19: a burst of rapid calls
// trips HTTP 429 "RESOURCE_EXHAUSTED ... please retry in Ns" — a TRANSIENT limit, not a hard
// quota). NOTE: the model matters — gemini-2.0-flash reports limit:0 for this key, while
// gemini-flash-latest has real working quota, so GEMINI_MODEL defaults to the latter. Because
// the research pipeline fans out ~45 calls at once, we tame the burst exactly like mistralClient:
//   1) a concurrency limiter (never more than GEMINI_MAX_CONCURRENCY requests in flight), and
//   2) retry-with-backoff on 429/5xx (honoring the Retry-After hint) so a throttled call waits
//      and succeeds instead of the leg failing instantly and scoring 0.
const genai = process.env.GEMINI_API_KEY ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) : null;
const GEMINI_DEFAULT_MODEL = process.env.GEMINI_MODEL ?? "gemini-flash-latest";

const GEMINI_MAX_CONCURRENCY = Math.max(1, Number(process.env.GEMINI_MAX_CONCURRENCY ?? 2));
const GEMINI_MAX_RETRIES = Math.max(0, Number(process.env.GEMINI_MAX_RETRIES ?? 6));
const GEMINI_BASE_BACKOFF_MS = 500;
// Gemini's free-tier limits are PER-MINUTE, so a 429's reset can be up to ~60s out. Cap the
// backoff at 30s (env-tunable) so a rate-limit block waits long enough to clear instead of
// burning all retries inside one minute. A server-provided retry hint still wins when present.
const GEMINI_MAX_BACKOFF_MS = Number(process.env.GEMINI_MAX_BACKOFF_MS ?? 30_000);

let geminiInFlight = 0;
const geminiWaiters: (() => void)[] = [];

async function acquireGeminiSlot(): Promise<void> {
  if (geminiInFlight < GEMINI_MAX_CONCURRENCY) {
    geminiInFlight += 1;
    return;
  }
  await new Promise<void>((resolve) => geminiWaiters.push(resolve));
  geminiInFlight += 1;
}

function releaseGeminiSlot(): void {
  geminiInFlight -= 1;
  const next = geminiWaiters.shift();
  if (next) next();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Is this SDK error a transient 429/5xx worth retrying? The @google/genai SDK surfaces the
 * HTTP status on the thrown error (as `.status`) and always embeds it in the message
 * ("got status: 429", "RESOURCE_EXHAUSTED"), so we check both. 401/400/404 are non-retryable. */
function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (typeof status === "number") return status === 429 || (status >= 500 && status < 600);
  const msg = err instanceof Error ? err.message : String(err);
  return /\b429\b|RESOURCE_EXHAUSTED|\b50[0-9]\b|UNAVAILABLE|overloaded/i.test(msg);
}

/** Pull a "retry in Ns" hint out of Gemini's 429 message when present (e.g. "Please retry in
 * 11.9s"), else fall back to exponential backoff with deterministic jitter (no Math.random in
 * this codebase). */
function backoffMs(attempt: number, err: unknown): number {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/retry in ([0-9.]+)s/i);
  const hintSec = m ? Number(m[1]) : NaN;
  if (Number.isFinite(hintSec) && hintSec > 0) return Math.min(Math.ceil(hintSec * 1000) + 250, GEMINI_MAX_BACKOFF_MS);
  const expo = Math.min(GEMINI_BASE_BACKOFF_MS * 2 ** attempt, GEMINI_MAX_BACKOFF_MS);
  return expo + Math.floor((expo / 2) * ((geminiInFlight % 7) / 7));
}

/** Runs `fn` with a concurrency slot held, retrying transient 429/5xx with backoff. Mirrors
 * mistralClient.fetchWithRetry — same throttle-at-the-source + ride-out-the-rate-limit posture. */
async function withRetry<R>(fn: () => Promise<R>): Promise<R> {
  await acquireGeminiSlot();
  try {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= GEMINI_MAX_RETRIES; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        if (!isRetryable(err) || attempt === GEMINI_MAX_RETRIES) throw err;
        const wait = backoffMs(attempt, err);
        logger.warn(`geminiClient: rate-limited/transient — retrying in ${wait}ms (attempt ${attempt + 1}/${GEMINI_MAX_RETRIES})`);
        await sleep(wait);
      }
    }
    throw lastErr;
  } finally {
    releaseGeminiSlot();
  }
}

function toGeminiContents(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] }));
}

/**
 * Forces a single named function call via Gemini's toolConfig
 * (`functionCallingConfig: {mode:"ANY", allowedFunctionNames:[name]}`) — the closest
 * equivalent to OpenAI's/Claude's forced tool-choice. Same contract as the other clients'
 * runStructured: returns the parsed function args, or null if the model didn't call it (or
 * Gemini isn't configured).
 */
export async function runStructured<T>(opts: {
  model?: string;
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}): Promise<T | null> {
  if (!genai) return null;
  const model = opts.model ?? GEMINI_DEFAULT_MODEL;

  const response = await withRetry(() => genai.models.generateContent({
    model,
    contents: toGeminiContents(opts.messages),
    config: {
      systemInstruction: opts.system,
      maxOutputTokens: opts.maxTokens,
      tools: [{ functionDeclarations: [{ name: opts.tool.name, description: opts.tool.description, parameters: opts.tool.input_schema }] }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [opts.tool.name] } },
    },
  }));

  recordTokens({ provider: "google", model, kind: "structured", inputTokens: response.usageMetadata?.promptTokenCount ?? 0, outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0 });
  recordGlobalLlmUsage((response.usageMetadata?.promptTokenCount ?? 0) + (response.usageMetadata?.candidatesTokenCount ?? 0));

  const call = response.functionCalls?.[0];
  return call?.args ? (call.args as T) : null;
}

/** Plain generateContent call, no tools — returns Gemini's text, or null if empty/not configured. */
export async function runText(opts: { model?: string; maxTokens: number; system?: string; messages: ChatMessage[] }): Promise<string | null> {
  if (!genai) return null;
  const model = opts.model ?? GEMINI_DEFAULT_MODEL;

  const response = await withRetry(() => genai.models.generateContent({
    model,
    contents: toGeminiContents(opts.messages),
    config: { systemInstruction: opts.system, maxOutputTokens: opts.maxTokens },
  }));
  recordTokens({ provider: "google", model, kind: "text", inputTokens: response.usageMetadata?.promptTokenCount ?? 0, outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0 });
  recordGlobalLlmUsage((response.usageMetadata?.promptTokenCount ?? 0) + (response.usageMetadata?.candidatesTokenCount ?? 0));

  return response.text ?? null;
}
