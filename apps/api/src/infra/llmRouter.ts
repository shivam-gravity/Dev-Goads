import { logger } from "../modules/logger/logger.js";
import * as openaiClient from "./openaiClient.js";
import * as ollamaClient from "./ollamaClient.js";
import * as claudeClient from "./claudeClient.js";
import * as geminiClient from "./geminiClient.js";
import type { ChatMessage, JsonSchemaTool } from "./openaiClient.js";

/**
 * Provider-aware dispatch across all four LLM backends — the one place that knows how to
 * actually reach each provider. Callers (agents/support.ts, research/providers/support.ts,
 * research/decision/support.ts) never import openaiClient/ollamaClient/claudeClient/
 * geminiClient directly; they resolve an LLMAssignment via llmTaskConfig.ts and call this.
 *
 * An assignment of "openai" is the reliable default and is called directly, no wrapping.
 * Any other assignment gets a timeout + automatic fallback to OpenAI on failure — the
 * assigned provider is the new/experimental leg, OpenAI is the safety net, same shape as
 * infra/scrapeFallback.ts's in-house-then-Firecrawl pattern, just inverted (here the
 * *reliable* leg is the fallback, not the first attempt). This is also what makes it safe
 * to assign a task to "anthropic"/"google" before a key is configured: the client returns
 * null immediately, which this treats as "unusable" and falls through to OpenAI — so an
 * unconfigured provider degrades to today's exact behavior instead of erroring.
 */

export type LLMProvider = "openai" | "ollama" | "anthropic" | "google";
export interface LLMAssignment {
  provider: LLMProvider;
  model: string;
}

const CLIENTS = {
  openai: openaiClient,
  ollama: ollamaClient,
  anthropic: claudeClient,
  google: geminiClient,
};

// Kill switch — set to "false" to disable the fallback-to-OpenAI safety net and let an
// assigned non-OpenAI provider fail outright instead, mirroring
// SCRAPE_FALLBACK_ENABLED's precedent from the Firecrawl fallback work.
const FALLBACK_ENABLED = process.env.LLM_TASK_FALLBACK_ENABLED !== "false";

// Ollama runs CPU-bound local inference on typical dev hardware (no GPU acceleration) —
// genuinely slower than a hosted API, so it gets a longer budget. Claude/Gemini are hosted
// APIs with normal network latency, closer to OpenAI's own — shorter budget suffices.
const OLLAMA_TIMEOUT_MS = 30_000;
const HOSTED_ALT_TIMEOUT_MS = 15_000;

function timeoutFor(provider: LLMProvider): number {
  return provider === "ollama" ? OLLAMA_TIMEOUT_MS : HOSTED_ALT_TIMEOUT_MS;
}

/** Races `promise` against a plain timer. A soft timeout — stops waiting, doesn't
 * necessarily cancel the underlying request — which is all that's needed here: the goal is
 * only that a slow/hung alternative-provider call can't block its own OpenAI fallback. */
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

// openaiClient.ts's runStructured/runText throw when OPENAI_API_KEY is unset (unlike the
// three newer clients, which return null on "not configured") — every other layer in this
// codebase treats "no live data" as a graceful degrade, never a throw, so this router
// normalizes that difference once here rather than leaking OpenAI's throw-on-missing-key
// behavior into every caller.
async function safeOpenAIStructured<T>(opts: StructuredOpts & { model?: string }): Promise<T | null> {
  try {
    return await openaiClient.runStructured<T>(opts);
  } catch (err) {
    logger.warn("llmRouter: OpenAI call failed (or OPENAI_API_KEY unset)", err);
    return null;
  }
}

async function safeOpenAIText(opts: TextOpts & { model?: string }): Promise<string | null> {
  try {
    return await openaiClient.runText(opts);
  } catch (err) {
    logger.warn("llmRouter: OpenAI call failed (or OPENAI_API_KEY unset)", err);
    return null;
  }
}

export async function runStructured<T>(assignment: LLMAssignment, opts: StructuredOpts): Promise<RunResult<T>> {
  if (assignment.provider === "openai") {
    const data = await safeOpenAIStructured<T>({ ...opts, model: assignment.model });
    return { data, source: "openai" };
  }

  if (!FALLBACK_ENABLED) {
    const data = await CLIENTS[assignment.provider].runStructured<T>({ ...opts, model: assignment.model });
    return { data, source: assignment.provider };
  }

  try {
    const client = CLIENTS[assignment.provider];
    const data = await raceWithTimeout(client.runStructured<T>({ ...opts, model: assignment.model }), timeoutFor(assignment.provider));
    if (data !== null) return { data, source: assignment.provider };
    logger.warn(`llmRouter: ${assignment.provider}:${assignment.model} produced no usable result — falling back to OpenAI`);
  } catch (err) {
    logger.warn(`llmRouter: ${assignment.provider}:${assignment.model} failed — falling back to OpenAI`, err);
  }

  const data = await safeOpenAIStructured<T>(opts);
  return { data, source: "openai" };
}

export async function runText(assignment: LLMAssignment, opts: TextOpts): Promise<RunResult<string>> {
  if (assignment.provider === "openai") {
    const data = await safeOpenAIText({ ...opts, model: assignment.model });
    return { data, source: "openai" };
  }

  if (!FALLBACK_ENABLED) {
    const data = await CLIENTS[assignment.provider].runText({ ...opts, model: assignment.model });
    return { data, source: assignment.provider };
  }

  try {
    const client = CLIENTS[assignment.provider];
    const data = await raceWithTimeout(client.runText({ ...opts, model: assignment.model }), timeoutFor(assignment.provider));
    if (data !== null) return { data, source: assignment.provider };
    logger.warn(`llmRouter: ${assignment.provider}:${assignment.model} produced no usable text result — falling back to OpenAI`);
  } catch (err) {
    logger.warn(`llmRouter: ${assignment.provider}:${assignment.model} failed — falling back to OpenAI`, err);
  }

  const data = await safeOpenAIText(opts);
  return { data, source: "openai" };
}
