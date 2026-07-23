import type { LLMAssignment, LLMProvider } from "./llmRouter.js";

/**
 * One flat registry, shared by all three LLM call surfaces — the 20 agents, research
 * providers, and the Decision Engine — since a "task" is a task regardless of which
 * subsystem it lives in. The pipeline depends FULLY on Claude via Amazon Bedrock: every task
 * resolves to the same Bedrock assignment, so this registry now exists only to (a) keep the
 * per-task env-override mechanism (LLM_TASK_<NAME>="bedrock:model") for quick model swaps and
 * (b) let a specific task pin a different Bedrock model if ever needed.
 *
 * Keys: agent promptIds (e.g. "budget-agent"), research provider names (e.g.
 * "competitor", "reviews"), decision-engine step names (e.g. "decision-summary",
 * "recommendation-ranking", "tradeoff-analysis", "strategy-synthesis",
 * "context-enrichment").
 */
const BEDROCK: LLMAssignment = { provider: "bedrock", model: process.env.BEDROCK_MODEL ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0" };

const DEFAULT_ASSIGNMENT: LLMAssignment = BEDROCK;

const TASK_MODEL_REGISTRY: Record<string, LLMAssignment> = {
  // 3 composite super-agents (the default roster) — each does several of the individual agents'
  // jobs in ONE structured call, cutting the agent layer from 20 calls to 3.
  "strategy-agent": BEDROCK,
  "creative-offer-agent": BEDROCK,
  "reviewer-agent": BEDROCK,

  // 20 marketing agents
  "campaign-agent": BEDROCK,
  "audience-agent": BEDROCK,
  "budget-agent": BEDROCK,
  "competitor-agent": BEDROCK,
  "channel-placement-agent": BEDROCK,
  "compliance-agent": BEDROCK,
  "critic-agent": BEDROCK,
  "forecasting-kpi-agent": BEDROCK,
  "funnel-retargeting-agent": BEDROCK,
  "creative-agent": BEDROCK,
  "keyword-agent": BEDROCK,
  "localization-agent": BEDROCK,
  "market-agent": BEDROCK,
  "landing-page-agent": BEDROCK,
  "objection-handling-agent": BEDROCK,
  "persona-agent": BEDROCK,
  "pricing-offer-agent": BEDROCK,
  "seo-content-agent": BEDROCK,
  "seasonality-timing-agent": BEDROCK,
  "product-agent": BEDROCK,

  // Decision Engine steps — the USER-VISIBLE strategy output.
  "decision-summary": BEDROCK,
  "enrichment-proof-points": BEDROCK,
  "enrichment-regional-depth": BEDROCK,
  "tradeoff-analysis": BEDROCK,
  "recommendation-generation": BEDROCK,
  "strategy-synthesis": BEDROCK,

  // Research providers
  "app-store": BEDROCK,
  audience: BEDROCK,
  "ad-library": BEDROCK,
  competitor: BEDROCK,
  company: BEDROCK,
  autocomplete: BEDROCK,
  "backlink-authority": BEDROCK,
  funding: BEDROCK,
  "serp-features": BEDROCK,
  "hiring-signals": BEDROCK,
  "content-marketing": BEDROCK,
  "legal-regulatory": BEDROCK,
  "local-presence": BEDROCK,
  market: BEDROCK,
  partnerships: BEDROCK,
  product: BEDROCK,
  reddit: BEDROCK,
  reviews: BEDROCK,
  seo: BEDROCK,
  "social-media": BEDROCK,
  technology: BEDROCK,
  "video-presence": BEDROCK,
  website: BEDROCK,
  navigation: BEDROCK,
  news: BEDROCK,
  search: BEDROCK,
  "search-ranking": BEDROCK,

  // Intelligence Engines + crawl fact extraction
  "audience-intelligence": BEDROCK,
  "competitor-intelligence-discovery": BEDROCK,
  "competitor-intelligence-enrichment": BEDROCK,
  "creative-intelligence": BEDROCK,
  "market-intelligence": BEDROCK,
  "pricing-intelligence": BEDROCK,
  "landing-page-intelligence": BEDROCK,
  // The single most valuable call in the run (its facts replace ~17 downstream retrievals) and
  // it's on the CRITICAL PATH — the whole fact-first pipeline is skipped if it doesn't return in
  // time. Bedrock has ample throughput and no free-tier rate storm.
  "crawl-fact-extraction": BEDROCK,
  "ad-creative-analysis": BEDROCK,

  // Meta Ads keyword validation & interest mining
  "meta-interest-mining": BEDROCK,
  "meta-keyword-validation": BEDROCK,
  "budget-market-calibration": BEDROCK,
};

const VALID_PROVIDERS = new Set<string>(["bedrock"]);

/**
 * Resolution order: per-task env override (quick experiments, no code change) → static
 * registry (checked-in, deliberate) → global default. Env var format:
 * `LLM_TASK_<TASK_NAME>="provider:model"`, e.g. `LLM_TASK_BUDGET_AGENT="bedrock:us.anthropic.claude-opus-4-1-20250805-v1:0"`.
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
