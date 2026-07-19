import type { LLMAssignment, LLMProvider } from "./llmRouter.js";

/**
 * One flat registry, shared by all three LLM call surfaces — the 20 agents, research
 * providers, and the Decision Engine — since a "task" is a task regardless of which
 * subsystem it lives in. Every task not listed here falls through to DEFAULT_ASSIGNMENT
 * (Mistral) until a row is added or overridden via an env var.
 *
 * Keys: agent promptIds (e.g. "budget-agent"), research provider names (e.g.
 * "competitor", "reviews"), decision-engine step names (e.g. "decision-summary",
 * "recommendation-ranking", "tradeoff-analysis", "strategy-synthesis",
 * "context-enrichment").
 */
const DEFAULT_ASSIGNMENT: LLMAssignment = { provider: "mistral", model: process.env.MISTRAL_MODEL ?? "mistral-small-latest" };

const GEMINI: LLMAssignment = { provider: "google", model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash" };
const MISTRAL: LLMAssignment = { provider: "mistral", model: process.env.MISTRAL_MODEL ?? "mistral-small-latest" };
// "dual" fires OpenRouter AND Mistral concurrently and keeps the more complete answer (see
// llmRouter.runStructuredDual) — the deep-research quality lever. The `model` here is only a
// nominal hint and is IGNORED by the dual path: each leg uses its own provider-appropriate
// model (OPENROUTER_MODEL / MISTRAL_MODEL env, else that client's baked-in default), because
// passing one shared model name to both makes the wrong provider 404. This doubles token spend
// per call by design, spreading load across both providers so neither alone bottlenecks a run.
const DUAL: LLMAssignment = { provider: "dual", model: "auto" };
// Deep-research tasks (the 20 agents + the research providers that extract/analyze real web
// data) now run dual for best-of-both quality. Renamed from the old DEEP_RESEARCH alias, which was
// already just Mistral — this makes those same tasks concurrent instead of single-provider.
const DEEP_RESEARCH: LLMAssignment = DUAL;

const TASK_MODEL_REGISTRY: Record<string, LLMAssignment> = {
  // 20 marketing agents — 70B for deep, genuine analysis
  "campaign-agent": DEEP_RESEARCH,
  "audience-agent": DEEP_RESEARCH,
  "budget-agent": DEEP_RESEARCH,
  "competitor-agent": DEEP_RESEARCH,
  "channel-placement-agent": DEEP_RESEARCH,
  "compliance-agent": DEEP_RESEARCH,
  "critic-agent": DEEP_RESEARCH,
  "forecasting-kpi-agent": DEEP_RESEARCH,
  "funnel-retargeting-agent": DEEP_RESEARCH,
  "creative-agent": DEEP_RESEARCH,
  "keyword-agent": DEEP_RESEARCH,
  "localization-agent": DEEP_RESEARCH,
  "market-agent": DEEP_RESEARCH,
  "landing-page-agent": DEEP_RESEARCH,
  "objection-handling-agent": DEEP_RESEARCH,
  "persona-agent": DEEP_RESEARCH,
  "pricing-offer-agent": DEEP_RESEARCH,
  "seo-content-agent": DEEP_RESEARCH,
  "seasonality-timing-agent": DEEP_RESEARCH,
  "product-agent": DEEP_RESEARCH,

  // Decision Engine steps — Gemini/Mistral for synthesis diversity
  "decision-summary": GEMINI,
  "enrichment-proof-points": GEMINI,
  "enrichment-regional-depth": MISTRAL,
  "tradeoff-analysis": MISTRAL,
  "recommendation-generation": GEMINI,
  "strategy-synthesis": MISTRAL,

  // Research providers — 70B for accurate data extraction
  "app-store": DEEP_RESEARCH,
  audience: DEEP_RESEARCH,
  "ad-library": DEEP_RESEARCH,
  competitor: DEEP_RESEARCH,
  company: DEEP_RESEARCH,
  autocomplete: DEEP_RESEARCH,
  "backlink-authority": DEEP_RESEARCH,
  funding: DEEP_RESEARCH,
  "serp-features": DEEP_RESEARCH,
  "hiring-signals": DEEP_RESEARCH,
  "content-marketing": DEEP_RESEARCH,
  "legal-regulatory": DEEP_RESEARCH,
  "local-presence": DEEP_RESEARCH,
  market: DEEP_RESEARCH,
  partnerships: DEEP_RESEARCH,
  product: DEEP_RESEARCH,
  reddit: DEEP_RESEARCH,
  reviews: DEEP_RESEARCH,
  seo: DEEP_RESEARCH,
  "social-media": DEEP_RESEARCH,
  technology: DEEP_RESEARCH,
  "video-presence": DEEP_RESEARCH,
  website: DEEP_RESEARCH,
  navigation: DEEP_RESEARCH,
  news: DEEP_RESEARCH,
  search: DEEP_RESEARCH,
  "search-ranking": DEEP_RESEARCH,

  // Intelligence Engines + crawl fact extraction — mixed for diversity
  "audience-intelligence": GEMINI,
  "competitor-intelligence-discovery": DEEP_RESEARCH,
  "competitor-intelligence-enrichment": DEEP_RESEARCH,
  "creative-intelligence": GEMINI,
  "market-intelligence": DEEP_RESEARCH,
  "pricing-intelligence": GEMINI,
  "landing-page-intelligence": DEEP_RESEARCH,
  // The single most valuable call in the run (its facts replace ~17 downstream retrievals), and
  // it's on the CRITICAL PATH — the whole fact-first pipeline is skipped if it doesn't return in
  // time. It was assigned GEMINI (free tier = 0 → failed → fell through to throttled OpenRouter/
  // Mistral → blew the prefetch timeout). "dual" fires OpenRouter + Mistral concurrently (best of
  // two shots at a fast answer), and the fallback chain ends in local Ollama, so this call
  // completes even when both hosted tiers throttle — no more silent prefetch timeouts.
  "crawl-fact-extraction": DUAL,
  "ad-creative-analysis": DEEP_RESEARCH,

  // Meta Ads keyword validation & interest mining
  "meta-interest-mining": DEEP_RESEARCH,
  "meta-keyword-validation": DEEP_RESEARCH,
  "budget-market-calibration": DEEP_RESEARCH,
};

const VALID_PROVIDERS = new Set<string>(["openrouter", "ollama", "mistral", "google", "dual"]);

/**
 * Resolution order: per-task env override (quick experiments, no code change) → static
 * registry (checked-in, deliberate) → global default. Env var format:
 * `LLM_TASK_<TASK_NAME>="provider:model"`, e.g. `LLM_TASK_BUDGET_AGENT="ollama:llama3.1"`.
 * A malformed override (missing `:model`, or an unrecognized provider) is ignored rather
 * than thrown — falls through to the static registry/default instead.
 */
export function resolveTaskModel(taskName: string): LLMAssignment {
  const envKey = `LLM_TASK_${taskName.toUpperCase().replace(/-/g, "_")}`;
  const envOverride = process.env[envKey];
  if (envOverride) {
    const separatorIndex = envOverride.indexOf(":");
    if (separatorIndex > 0) {
      const provider = envOverride.slice(0, separatorIndex);
      const model = envOverride.slice(separatorIndex + 1);
      if (VALID_PROVIDERS.has(provider) && model) {
        return { provider: provider as LLMProvider, model };
      }
    }
  }
  return TASK_MODEL_REGISTRY[taskName] ?? DEFAULT_ASSIGNMENT;
}
