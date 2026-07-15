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

const OLLAMA: LLMAssignment = { provider: "ollama", model: process.env.OLLAMA_MODEL ?? "llama3.2" };
const GEMINI: LLMAssignment = { provider: "google", model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash" };
const MISTRAL: LLMAssignment = { provider: "mistral", model: process.env.MISTRAL_MODEL ?? "mistral-small-latest" };

// OpenAI and Anthropic/Claude have been removed from this platform entirely (see
// infra/llmClient.ts's doc comment for what that gives up — hosted web search, image
// generation). Four providers remain: Ollama for the 20 agents + research-provider
// structuring steps (high call volume, tolerates Ollama's slower local inference), Gemini
// and Mistral split across the lower-volume synthesis/narrative steps (Decision Engine +
// Intelligence Engines) for provider diversity rather than leaning on one free tier alone.
// Groq is DEFAULT_ASSIGNMENT/fallback-of-last-resort for everything (see llmRouter.ts) —
// deliberately NOT also assigned as a primary task below, so a Groq fallback is a genuinely
// different leg from whatever primary provider just failed, not the same one retried.
const TASK_MODEL_REGISTRY: Record<string, LLMAssignment> = {
  // 20 marketing agents (agents/agents/*.ts, keyed by promptId)
  "campaign-agent": OLLAMA,
  "audience-agent": OLLAMA,
  "budget-agent": OLLAMA,
  "competitor-agent": OLLAMA,
  "channel-placement-agent": OLLAMA,
  "compliance-agent": OLLAMA,
  "critic-agent": OLLAMA,
  "forecasting-kpi-agent": OLLAMA,
  "funnel-retargeting-agent": OLLAMA,
  "creative-agent": OLLAMA,
  "keyword-agent": OLLAMA,
  "localization-agent": OLLAMA,
  "market-agent": OLLAMA,
  "landing-page-agent": OLLAMA,
  "objection-handling-agent": OLLAMA,
  "persona-agent": OLLAMA,
  "pricing-offer-agent": OLLAMA,
  "seo-content-agent": OLLAMA,
  "seasonality-timing-agent": OLLAMA,
  "product-agent": OLLAMA,

  // Decision Engine steps (research/decision/*.ts, keyed by taskName)
  "decision-summary": GEMINI,
  "enrichment-proof-points": GEMINI,
  "enrichment-regional-depth": MISTRAL,
  "tradeoff-analysis": MISTRAL,
  "recommendation-generation": GEMINI,
  "strategy-synthesis": MISTRAL,

  // Research providers' structuring step (research/providers/*.ts, keyed by provider name;
  // the web-search step itself has no provider equivalent and always returns empty now —
  // see infra/llmClient.ts's runWebSearch)
  "app-store": OLLAMA,
  audience: OLLAMA,
  "ad-library": OLLAMA,
  competitor: OLLAMA,
  company: OLLAMA,
  autocomplete: OLLAMA,
  "backlink-authority": OLLAMA,
  funding: OLLAMA,
  "serp-features": OLLAMA,
  "hiring-signals": OLLAMA,
  "content-marketing": OLLAMA,
  "legal-regulatory": OLLAMA,
  "local-presence": OLLAMA,
  market: OLLAMA,
  partnerships: OLLAMA,
  product: OLLAMA,
  reddit: OLLAMA,
  reviews: OLLAMA,
  seo: OLLAMA,
  "social-media": OLLAMA,
  technology: OLLAMA,
  "video-presence": OLLAMA,
  website: OLLAMA,
  navigation: OLLAMA,
  news: OLLAMA,
  search: OLLAMA,
  "search-ranking": OLLAMA,

  // Intelligence Engines + crawl fact extraction
  "audience-intelligence": GEMINI,
  "competitor-intelligence-discovery": MISTRAL,
  "competitor-intelligence-enrichment": MISTRAL,
  "creative-intelligence": GEMINI,
  "market-intelligence": MISTRAL,
  "pricing-intelligence": GEMINI,
  "landing-page-intelligence": MISTRAL,
  "crawl-fact-extraction": GEMINI,
  "ad-creative-analysis": MISTRAL,
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
