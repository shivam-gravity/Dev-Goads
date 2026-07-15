import { logger } from "../modules/logger/logger.js";
import * as groqClient from "./groqClient.js";
import * as ollamaClient from "./ollamaClient.js";
import * as mistralClient from "./mistralClient.js";
import * as geminiClient from "./geminiClient.js";
import type { ChatMessage, JsonSchemaTool } from "./llmTypes.js";
import { assertGlobalLlmUsageAvailable } from "./llmUsageBoundary.js";

/**
 * Provider-aware dispatch across all four LLM backends — the one place that knows how to
 * actually reach each provider. Callers (agents/support.ts, research/providers/support.ts,
 * research/decision/support.ts) never import groqClient/ollamaClient/mistralClient/
 * geminiClient directly; they resolve an LLMAssignment via llmTaskConfig.ts and call this.
 *
 * Groq replaces OpenAI as the reliable default (OpenAI and Anthropic/Claude have been
 * removed from this platform entirely — see infra/llmClient.ts for what that cost: no
 * replacement for OpenAI's hosted web search or image generation). An assignment of "groq"
 * is called directly first; any other assignment gets a timeout + automatic fallback on
 * failure — the assigned provider is the new/experimental leg, same shape as
 * infra/scrapeFallback.ts's in-house-then-Firecrawl pattern, just inverted (here the
 * *reliable* leg is the fallback, not the first attempt).
 *
 * FALLBACK_CHAIN below is tried in order (skipping whichever provider was already
 * attempted) whenever the first attempt fails — Groq is no longer a dead end. A single
 * shared Groq key is both the default assignment for most tasks AND was, until this chain
 * existed, the ONLY fallback leg: the day Groq's own daily token quota got exhausted (from
 * heavy same-day testing against one key), every task defaulted to Groq had nowhere left
 * to go and the entire pipeline degraded to "no live research" placeholders simultaneously
 * (see the 2026-07-15 polluxa.com campaign-generation run — 526 Groq 429s in one job,
 * 23/27 research providers falling back). Mistral/Gemini now catch that case instead of
 * every task failing at once. Ollama is intentionally NOT in this chain — it's a
 * deliberately-assigned local/slow leg for specific tasks, not a general safety net.
 * This is also what makes it safe to assign a task to "mistral"/"google" before a key is
 * configured: the client returns null, which this treats as "unusable" and falls through.
 */

export type LLMProvider = "groq" | "ollama" | "mistral" | "google";
export interface LLMAssignment {
  provider: LLMProvider;
  model: string;
}

const CLIENTS = {
  groq: groqClient,
  ollama: ollamaClient,
  mistral: mistralClient,
  google: geminiClient,
};

// Tried in order (skipping whatever was already attempted) whenever the first attempt
// fails or is unconfigured. Ollama deliberately excluded — see the file-level doc comment.
const FALLBACK_CHAIN: LLMProvider[] = ["groq", "mistral", "google"];

// Kill switch — set to "false" to disable the fallback-to-Groq safety net and let an
// assigned non-Groq provider fail outright instead, mirroring SCRAPE_FALLBACK_ENABLED's
// precedent from the Firecrawl fallback work.
const FALLBACK_ENABLED = process.env.LLM_TASK_FALLBACK_ENABLED !== "false";

// Ollama runs CPU-bound local inference on typical dev hardware (no GPU acceleration) —
// genuinely slower than a hosted API, so it gets a longer budget. Mistral/Gemini are
// hosted APIs with normal network latency, closer to Groq's own — shorter budget suffices,
// though observed live 2026-07-16: Mistral generating a large structured-output schema
// (e.g. AudienceIntelligenceEngine's ~2048-token personas/ICP/customerJourney object) can
// genuinely take longer than 15s to finish, at which point this soft timeout gives up and
// tries the next provider while the real Mistral request keeps running unseen in the
// background (raceWithTimeout doesn't cancel it) — wasted work, and a fallback opportunity
// lost for no real benefit since Mistral would have eventually returned real data.
const OLLAMA_TIMEOUT_MS = 30_000;
const HOSTED_ALT_TIMEOUT_MS = 20_000;

function timeoutFor(provider: LLMProvider): number {
  return provider === "ollama" ? OLLAMA_TIMEOUT_MS : HOSTED_ALT_TIMEOUT_MS;
}

/** Races `promise` against a plain timer. A soft timeout — stops waiting, doesn't
 * necessarily cancel the underlying request — which is all that's needed here: the goal is
 * only that a slow/hung alternative-provider call can't block its own Groq fallback. */
function raceWithTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`LLM call timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

interface StructuredOpts {
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
  tool: JsonSchemaTool;
}

interface TextOpts {
  maxTokens: number;
  system?: string;
  messages: ChatMessage[];
}

/** `source` reports which provider actually produced `data` — including whether a
 * fallback occurred — so callers (callAgentModel, webSearchThenStructure,
 * callDecisionModel) can surface it on their own result types for later inspection. */
export interface RunResult<T> {
  data: T | null;
  source: LLMProvider;
}

async function safeGroqStructured<T>(opts: StructuredOpts & { model?: string }): Promise<T | null> {
  try {
    return await groqClient.runStructured<T>(opts);
  } catch (err) {
    logger.warn("llmRouter: Groq call failed (or GROQ_API_KEY unset)", err);
    return null;
  }
}

async function safeGroqText(opts: TextOpts & { model?: string }): Promise<string | null> {
  try {
    return await groqClient.runText(opts);
  } catch (err) {
    logger.warn("llmRouter: Groq call failed (or GROQ_API_KEY unset)", err);
    return null;
  }
}

/** Walks FALLBACK_CHAIN in order, skipping `alreadyTried` (the provider the caller already
 * attempted), stopping at the first one that returns usable data. Reports `alreadyTried` as
 * `source` if the whole chain is exhausted — `data` is null in that case regardless, so
 * `source` is only informational (which leg was attempted last), matching the existing
 * convention on total failure. */
async function fallbackChainStructured<T>(opts: StructuredOpts, alreadyTried: LLMProvider): Promise<RunResult<T>> {
  for (const provider of FALLBACK_CHAIN) {
    if (provider === alreadyTried) continue;
    try {
      const data = await raceWithTimeout(CLIENTS[provider].runStructured<T>(opts), timeoutFor(provider));
      if (data !== null) return { data, source: provider };
      logger.warn(`llmRouter: fallback provider ${provider} produced no usable result`);
    } catch (err) {
      logger.warn(`llmRouter: fallback provider ${provider} failed`, err);
    }
  }
  return { data: null, source: alreadyTried };
}

async function fallbackChainText(opts: TextOpts, alreadyTried: LLMProvider): Promise<RunResult<string>> {
  for (const provider of FALLBACK_CHAIN) {
    if (provider === alreadyTried) continue;
    try {
      const data = await raceWithTimeout(CLIENTS[provider].runText(opts), timeoutFor(provider));
      if (data !== null) return { data, source: provider };
      logger.warn(`llmRouter: fallback provider ${provider} produced no usable text result`);
    } catch (err) {
      logger.warn(`llmRouter: fallback provider ${provider} failed`, err);
    }
  }
  return { data: null, source: alreadyTried };
}

export async function runStructured<T>(assignment: LLMAssignment, opts: StructuredOpts): Promise<RunResult<T>> {
  // Checked before every other branch, including the direct-Groq path and the fallback
  // chain below — see llmUsageBoundary.ts for why this is a hard stop with no fallback,
  // unlike the per-provider degrade-and-continue pattern everywhere else in this router.
  assertGlobalLlmUsageAvailable();

  if (assignment.provider === "groq") {
    const data = await safeGroqStructured<T>({ ...opts, model: assignment.model });
    if (data !== null) return { data, source: "groq" };
    if (!FALLBACK_ENABLED) return { data: null, source: "groq" };
    logger.warn("llmRouter: groq (default provider) failed — trying fallback chain");
    return fallbackChainStructured<T>(opts, "groq");
  }

  if (!FALLBACK_ENABLED) {
    const data = await CLIENTS[assignment.provider].runStructured<T>({ ...opts, model: assignment.model });
    return { data, source: assignment.provider };
  }

  try {
    const client = CLIENTS[assignment.provider];
    const data = await raceWithTimeout(client.runStructured<T>({ ...opts, model: assignment.model }), timeoutFor(assignment.provider));
    if (data !== null) return { data, source: assignment.provider };
    logger.warn(`llmRouter: ${assignment.provider}:${assignment.model} produced no usable result — falling back`);
  } catch (err) {
    logger.warn(`llmRouter: ${assignment.provider}:${assignment.model} failed — falling back`, err);
  }

  return fallbackChainStructured<T>(opts, assignment.provider);
}

export async function runText(assignment: LLMAssignment, opts: TextOpts): Promise<RunResult<string>> {
  assertGlobalLlmUsageAvailable();

  if (assignment.provider === "groq") {
    const data = await safeGroqText({ ...opts, model: assignment.model });
    if (data !== null) return { data, source: "groq" };
    if (!FALLBACK_ENABLED) return { data: null, source: "groq" };
    logger.warn("llmRouter: groq (default provider) failed — trying fallback chain");
    return fallbackChainText(opts, "groq");
  }

  if (!FALLBACK_ENABLED) {
    const data = await CLIENTS[assignment.provider].runText({ ...opts, model: assignment.model });
    return { data, source: assignment.provider };
  }

  try {
    const client = CLIENTS[assignment.provider];
    const data = await raceWithTimeout(client.runText({ ...opts, model: assignment.model }), timeoutFor(assignment.provider));
    if (data !== null) return { data, source: assignment.provider };
    logger.warn(`llmRouter: ${assignment.provider}:${assignment.model} produced no usable text result — falling back`);
  } catch (err) {
    logger.warn(`llmRouter: ${assignment.provider}:${assignment.model} failed — falling back`, err);
  }

  return fallbackChainText(opts, assignment.provider);
}
