import { logger } from "../modules/logger/logger.js";
import * as openRouterClient from "./openRouterClient.js";
import * as ollamaClient from "./ollamaClient.js";
import * as mistralClient from "./mistralClient.js";
import * as geminiClient from "./geminiClient.js";
import * as bedrockClient from "./bedrockClient.js";
import type { ChatMessage, JsonSchemaTool } from "./llmTypes.js";
import { assertGlobalLlmUsageAvailable } from "./llmUsageBoundary.js";

/**
 * Provider-aware dispatch across all four LLM backends — the one place that knows how to
 * actually reach each provider. Callers (agents/support.ts, research/providers/support.ts,
 * research/decision/support.ts) never import openRouterClient/ollamaClient/mistralClient/
 * geminiClient directly; they resolve an LLMAssignment via llmTaskConfig.ts and call this.
 *
 * OpenRouter is the reliable default (it replaced Groq, which replaced OpenAI — OpenAI and
 * Anthropic/Claude were removed entirely; see infra/llmClient.ts for what that cost). An
 * assignment of "openrouter" is called directly first; any other assignment gets a timeout +
 * automatic fallback on failure — the assigned provider is the new/experimental leg, same
 * shape as infra/scrapeFallback.ts's dual-source pattern, just inverted (here the *reliable*
 * leg is the fallback, not the first attempt).
 *
 * FALLBACK_CHAIN below is tried in order (skipping whichever provider was already attempted)
 * whenever the first attempt fails. Groq was previously both the default AND the only fallback
 * leg, so the day its single-key daily token quota was exhausted, every task defaulted to it
 * had nowhere to go and the whole pipeline degraded to placeholders at once (the 2026-07-15
 * polluxa.com run — 526 Groq 429s in one job). Moving to OpenRouter (many upstream models
 * behind one key) plus Mistral/Gemini in the chain removes that single point of failure.
 * Ollama is intentionally NOT in this chain — it's a deliberately-assigned local/slow leg for
 * specific tasks, not a general safety net. This is also what makes it safe to assign a task to
 * "mistral"/"google" before a key is configured: the client returns null, which this treats as
 * "unusable" and falls through.
 */

export type LLMProvider = "openrouter" | "ollama" | "mistral" | "google" | "bedrock";
/** "dual" is a meta-provider, not a real backend: it fires OpenRouter AND Mistral concurrently
 * and keeps the higher-quality (more complete) result — see runStructuredDual/runTextDual. Used
 * for deep-research tasks where answer quality + resilience to one provider being rate-limited
 * both matter. The reported `source` on a dual result is always the real winning provider
 * ("openrouter" or "mistral"), never "dual". */
export type LLMProviderOrDual = LLMProvider | "dual";
export interface LLMAssignment {
  provider: LLMProviderOrDual;
  model: string;
}

// The two providers a "dual" assignment races, in the fixed order their Promise.allSettled
// results come back (index-aligned so a settled result knows which provider produced it).
const DUAL_PROVIDERS: readonly LLMProvider[] = ["openrouter", "mistral"];

const CLIENTS = {
  openrouter: openRouterClient,
  ollama: ollamaClient,
  mistral: mistralClient,
  google: geminiClient,
  bedrock: bedrockClient,
};

// Tried in order (skipping whatever was already attempted) whenever the first attempt fails or
// is unconfigured. Ollama is now the FINAL tier — the anti-timeout safety net: when every hosted
// provider is rate-limited (free-tier 429 storm), the chain used to exhaust and return null, so
// the provider "failed" and scored 0 (six providers hit this on the polluxa.com/crm run). A
// local model never rate-limits, so falling to it turns those hard 0s into real (if smaller)
// scores. It's LAST, not earlier, because it's slower/weaker than the hosted models — only worth
// reaching when they're all unavailable. Skipped automatically if nothing is listening on
// OLLAMA_BASE_URL (the call just errors and the chain ends, same as before). Disable by setting
// LLM_OLLAMA_FALLBACK=false.
const OLLAMA_FALLBACK_ENABLED = process.env.LLM_OLLAMA_FALLBACK !== "false";
// Bedrock (Claude) is a PAID, non-free-tier-throttled leg — the strongest-quality safety net when
// the free providers are all rate-limited. It sits AFTER the free tiers (mistral/openrouter/google)
// so a healthy free run never incurs Bedrock spend, but BEFORE local Ollama, since a hosted Claude
// call is far better than a slow local 8B model when the free tiers are exhausted. Only in the
// chain when AWS_BEARER_TOKEN_BEDROCK is set (an unconfigured client returns null and is skipped
// anyway); disable explicitly with LLM_BEDROCK_FALLBACK=false.
const BEDROCK_FALLBACK_ENABLED = process.env.LLM_BEDROCK_FALLBACK !== "false" && bedrockClient.isBedrockConfigured();
// When LLM_PRIMARY=bedrock we depend FULLY on Bedrock — no free-tier providers in the chain at
// all. Previously the chain led with mistral/openrouter, so any hiccup on the assigned Bedrock
// call degraded straight into free-tier (OpenRouter 429 "free-models-per-day exceeded", flaky
// Mistral) — which is exactly what produced the low-quality/slow runs. In bedrock mode the only
// fallback is Bedrock itself; otherwise keep the historical multi-provider chain.
const PRIMARY_IS_BEDROCK = process.env.LLM_PRIMARY === "bedrock";
const FALLBACK_CHAIN: LLMProvider[] = PRIMARY_IS_BEDROCK
  ? (["bedrock"] as LLMProvider[])
  : [
      "mistral",
      "openrouter",
      "google",
      ...(BEDROCK_FALLBACK_ENABLED ? (["bedrock"] as LLMProvider[]) : []),
      ...(OLLAMA_FALLBACK_ENABLED ? (["ollama"] as LLMProvider[]) : []),
    ];

// Kill switch — set to "false" to disable the fallback-to-Groq safety net and let an
// assigned non-Groq provider fail outright instead, mirroring SCRAPE_FALLBACK_ENABLED's
// precedent from the Firecrawl fallback work.
const FALLBACK_ENABLED = process.env.LLM_TASK_FALLBACK_ENABLED !== "false";

// Ollama runs CPU-bound local inference on typical dev hardware (no GPU acceleration) —
// genuinely slower than a hosted API, so it gets a longer budget.
//
// Hosted APIs get a LARGE budget now (was 30s) specifically because of free-tier rate limits:
// a free-tier call may sit in the client's concurrency queue AND ride out several 429
// Retry-After backoffs (each up to ~20s) before it finally succeeds. At 30s this soft race
// killed calls that were legitimately mid-retry — which is exactly what produced the "provider
// timed out after 45000ms" storm and the resulting low-confidence/confabulated runs. This
// ceiling must comfortably exceed the client's own timeout + backoff budget, or the retry
// machinery we added can never actually pay off. Tune down if you move to a fast paid model.
// Ollama is now the anti-timeout FINAL fallback (see FALLBACK_CHAIN), so its budget must be
// generous: a local 8B model doing a structured-schema completion on CPU can genuinely take
// 40-90s, and since we only reach it when every hosted provider is throttled, waiting for a real
// local answer beats returning a 0. Env-tunable.
const OLLAMA_TIMEOUT_MS = Number(process.env.LLM_OLLAMA_TIMEOUT_MS ?? 90_000);
const HOSTED_ALT_TIMEOUT_MS = Number(process.env.LLM_HOSTED_TIMEOUT_MS ?? 120_000);

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

async function safeOpenRouterStructured<T>(opts: StructuredOpts & { model?: string }): Promise<T | null> {
  try {
    return await openRouterClient.runStructured<T>(opts);
  } catch (err) {
    logger.warn("llmRouter: OpenRouter call failed (or OPENROUTER_API_KEY unset)", err);
    return null;
  }
}

async function safeOpenRouterText(opts: TextOpts & { model?: string }): Promise<string | null> {
  try {
    return await openRouterClient.runText(opts);
  } catch (err) {
    logger.warn("llmRouter: OpenRouter call failed (or OPENROUTER_API_KEY unset)", err);
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

/** Quality score for picking the better of two structured results. Both are already
 * schema-valid objects (each client returns null on invalid/truncated JSON), so "better"
 * means "more complete": more populated fields, deeper nesting, more total content. A serialized
 * length is a cheap, robust proxy — a result that filled more of the schema serializes longer
 * than one that left fields empty/short. Ties keep the first (OpenRouter) by using >, not >=. */
function structuredCompleteness(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}

/**
 * Each dual leg must use ITS OWN model, not a shared one — passing e.g. Mistral's
 * "mistral-small-latest" to OpenRouter (or vice-versa) makes the wrong provider 404 ("model does
 * not exist"), silently killing that leg. The `model` on a "dual" LLMAssignment is only a hint;
 * per provider we take an explicit env override if set (OPENROUTER_MODEL / MISTRAL_MODEL) else
 * `undefined`, which lets each client fall back to its own baked-in default. */
function dualModelFor(provider: LLMProvider): string | undefined {
  if (provider === "openrouter") return process.env.OPENROUTER_MODEL;
  if (provider === "mistral") return process.env.MISTRAL_MODEL;
  return undefined;
}

/**
 * Fire both DUAL_PROVIDERS (OpenRouter + Mistral) concurrently and keep the higher-quality result.
 * This is the "best-of-both" deep-research mode: quality (compare two independent answers,
 * take the more complete) AND resilience (if one provider is rate-limited / times out / returns
 * null, the other still answers). Uses both providers' token budgets per call by design —
 * spreading load so neither free tier alone is the bottleneck. Falls through to the normal
 * FALLBACK_CHAIN only if BOTH dual legs come back empty.
 */
async function runStructuredDual<T>(_model: string, opts: StructuredOpts): Promise<RunResult<T>> {
  const settled = await Promise.allSettled(
    DUAL_PROVIDERS.map((provider) =>
      raceWithTimeout(CLIENTS[provider].runStructured<T>({ ...opts, model: dualModelFor(provider) }), timeoutFor(provider))
    )
  );

  let best: { data: T; source: LLMProvider; score: number } | null = null;
  settled.forEach((outcome, i) => {
    const provider = DUAL_PROVIDERS[i];
    if (outcome.status === "rejected") {
      logger.warn(`llmRouter: dual leg ${provider} failed`, outcome.reason);
      return;
    }
    const data = outcome.value;
    if (data === null || data === undefined) {
      logger.warn(`llmRouter: dual leg ${provider} produced no usable result`);
      return;
    }
    const score = structuredCompleteness(data);
    if (!best || score > best.score) best = { data, source: provider, score };
  });

  if (best) return { data: (best as { data: T }).data, source: (best as { source: LLMProvider }).source };
  logger.warn("llmRouter: both dual legs (openrouter, mistral) failed — trying fallback chain");
  return fallbackChainStructured<T>(opts, "openrouter");
}

async function runTextDual(_model: string, opts: TextOpts): Promise<RunResult<string>> {
  const settled = await Promise.allSettled(
    DUAL_PROVIDERS.map((provider) =>
      raceWithTimeout(CLIENTS[provider].runText({ ...opts, model: dualModelFor(provider) }), timeoutFor(provider))
    )
  );

  let best: { data: string; source: LLMProvider } | null = null;
  settled.forEach((outcome, i) => {
    const provider = DUAL_PROVIDERS[i];
    if (outcome.status === "rejected") {
      logger.warn(`llmRouter: dual leg ${provider} failed`, outcome.reason);
      return;
    }
    const data = outcome.value;
    if (!data) return;
    // For plain text, "more complete" = longer coherent answer, same proxy as structured.
    if (!best || data.length > best.data.length) best = { data, source: provider };
  });

  if (best) return { data: (best as { data: string }).data, source: (best as { source: LLMProvider }).source };
  logger.warn("llmRouter: both dual legs (openrouter, mistral) failed — trying fallback chain");
  return fallbackChainText(opts, "openrouter");
}

export async function runStructured<T>(assignment: LLMAssignment, opts: StructuredOpts): Promise<RunResult<T>> {
  // Checked before every other branch, including the direct-OpenRouter path and the fallback
  // chain below — see llmUsageBoundary.ts for why this is a hard stop with no fallback,
  // unlike the per-provider degrade-and-continue pattern everywhere else in this router.
  assertGlobalLlmUsageAvailable();

  if (assignment.provider === "dual") return runStructuredDual<T>(assignment.model, opts);

  if (assignment.provider === "openrouter") {
    const data = await safeOpenRouterStructured<T>({ ...opts, model: assignment.model });
    if (data !== null) return { data, source: "openrouter" };
    if (!FALLBACK_ENABLED) return { data: null, source: "openrouter" };
    logger.warn("llmRouter: openrouter (default provider) failed — trying fallback chain");
    return fallbackChainStructured<T>(opts, "openrouter");
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

  if (assignment.provider === "dual") return runTextDual(assignment.model, opts);

  if (assignment.provider === "openrouter") {
    const data = await safeOpenRouterText({ ...opts, model: assignment.model });
    if (data !== null) return { data, source: "openrouter" };
    if (!FALLBACK_ENABLED) return { data: null, source: "openrouter" };
    logger.warn("llmRouter: openrouter (default provider) failed — trying fallback chain");
    return fallbackChainText(opts, "openrouter");
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
