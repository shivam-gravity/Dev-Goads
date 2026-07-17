import type { LLMAssignment, LLMProvider } from "./llmRouter.js";

/**
 * One flat registry, shared by all three LLM call surfaces — the 20 agents, research
 * providers, and the Decision Engine — since a "task" is a task regardless of which
 * subsystem it lives in. Every task not listed here falls through to DEFAULT_ASSIGNMENT
 * (Groq) until a row is added or overridden via an env var.
 *
 * Keys: agent promptIds (e.g. "budget-agent"), research provider names (e.g.
 * "competitor", "reviews"), decision-engine step names (e.g. "decision-summary",
 * "recommendation-ranking", "tradeoff-analysis", "strategy-synthesis",
 * "context-enrichment").
 */
const DEFAULT_ASSIGNMENT: LLMAssignment = { provider: "groq", model: "llama-3.3-70b-versatile" };

const GEMINI: LLMAssignment = { provider: "google", model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash" };
const MISTRAL: LLMAssignment = { provider: "mistral", model: process.env.MISTRAL_MODEL ?? "mistral-small-latest" };

// All 20 agents and research providers now route through Groq (llama-3.3-70b-versatile)
// as primary — a hosted 70B model that produces genuinely deep analysis, real budget
// calculations grounded in market data, and publication-quality ad copy. The previous
// Ollama (llama3.2, 8B local) assignment was too small to generate the depth needed for
// real campaign recommendations that drive growth. Gemini and Mistral remain on the
// synthesis/narrative steps for provider diversity. Groq as both primary AND fallback-of-
// last-resort means a single key exhaustion degrades everything simultaneously — but in
// practice Groq's free tier (14,400 req/day, 500k tokens/min) has never been hit under
// real usage, and the fallback chain (groq→mistral→google) catches any isolated failures.
const GROQ_70B: LLMAssignment = { provider: "groq", model: "llama-3.3-70b-versatile" };

const TASK_MODEL_REGISTRY: Record<string, LLMAssignment> = {
  // 20 marketing agents — 70B for deep, genuine analysis
  "campaign-agent": GROQ_70B,
  "audience-agent": GROQ_70B,
  "budget-agent": GROQ_70B,
  "competitor-agent": GROQ_70B,
  "channel-placement-agent": GROQ_70B,
  "compliance-agent": GROQ_70B,
  "critic-agent": GROQ_70B,
  "forecasting-kpi-agent": GROQ_70B,
  "funnel-retargeting-agent": GROQ_70B,
  "creative-agent": GROQ_70B,
  "keyword-agent": GROQ_70B,
  "localization-agent": GROQ_70B,
  "market-agent": GROQ_70B,
  "landing-page-agent": GROQ_70B,
  "objection-handling-agent": GROQ_70B,
  "persona-agent": GROQ_70B,
  "pricing-offer-agent": GROQ_70B,
  "seo-content-agent": GROQ_70B,
  "seasonality-timing-agent": GROQ_70B,
  "product-agent": GROQ_70B,

  // Decision Engine steps — Gemini/Mistral for synthesis diversity
  "decision-summary": GEMINI,
  "enrichment-proof-points": GEMINI,
  "enrichment-regional-depth": MISTRAL,
  "tradeoff-analysis": MISTRAL,
  "recommendation-generation": GEMINI,
  "strategy-synthesis": MISTRAL,

  // Research providers — 70B for accurate data extraction
  "app-store": GROQ_70B,
  audience: GROQ_70B,
  "ad-library": GROQ_70B,
  competitor: GROQ_70B,
  company: GROQ_70B,
  autocomplete: GROQ_70B,
  "backlink-authority": GROQ_70B,
  funding: GROQ_70B,
  "serp-features": GROQ_70B,
  "hiring-signals": GROQ_70B,
  "content-marketing": GROQ_70B,
  "legal-regulatory": GROQ_70B,
  "local-presence": GROQ_70B,
  market: GROQ_70B,
  partnerships: GROQ_70B,
  product: GROQ_70B,
  reddit: GROQ_70B,
  reviews: GROQ_70B,
  seo: GROQ_70B,
  "social-media": GROQ_70B,
  technology: GROQ_70B,
  "video-presence": GROQ_70B,
  website: GROQ_70B,
  navigation: GROQ_70B,
  news: GROQ_70B,
  search: GROQ_70B,
  "search-ranking": GROQ_70B,

  // Intelligence Engines + crawl fact extraction — mixed for diversity
  "audience-intelligence": GEMINI,
  "competitor-intelligence-discovery": GROQ_70B,
  "competitor-intelligence-enrichment": GROQ_70B,
  "creative-intelligence": GEMINI,
  "market-intelligence": GROQ_70B,
  "pricing-intelligence": GEMINI,
  "landing-page-intelligence": GROQ_70B,
  "crawl-fact-extraction": GEMINI,
  "ad-creative-analysis": GROQ_70B,

  // Meta Ads keyword validation & interest mining
  "meta-interest-mining": GROQ_70B,
  "meta-keyword-validation": GROQ_70B,
  "budget-market-calibration": GROQ_70B,
};

const VALID_PROVIDERS = new Set<string>(["groq", "ollama", "mistral", "google"]);

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
