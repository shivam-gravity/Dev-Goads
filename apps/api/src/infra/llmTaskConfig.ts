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
const MISTRAL: LLMAssignment = { provider: "mistral", model: process.env.MISTRAL_MODEL ?? "mistral-small-latest" };
const GEMINI_PRIMARY: LLMAssignment = { provider: "google", model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash" };
const BEDROCK_PRIMARY: LLMAssignment = { provider: "bedrock", model: process.env.BEDROCK_MODEL ?? "us.anthropic.claude-sonnet-4-5-20250929-v1:0" };

// PRIMARY workhorse for the whole pipeline. LLM_PRIMARY=gemini routes every task to Gemini (AI
// Studio free tier — fast, hosted, with a real per-minute/day allowance); LLM_PRIMARY=bedrock
// routes every task to Bedrock Claude (PAID, high-quality, not free-tier-throttled — best for the
// large multi-schema composite-agent calls that truncate on free tiers). Either way the OTHER
// providers sit behind the primary in llmRouter's FALLBACK_CHAIN for when a call fails. Set
// LLM_PRIMARY to something else (or unset) to fall back to the older Mistral/dual routing.
const PRIMARY_IS_BEDROCK = process.env.LLM_PRIMARY === "bedrock";
const PRIMARY_IS_GEMINI = process.env.LLM_PRIMARY === "gemini";

// Master switch (default ON before Gemini became primary): route EVERY task to Mistral only.
// Mistral has NO daily quota — just a per-minute rate limit (measured live: 50 req/min, 50k
// tokens/min) that our retry-with-backoff + concurrency cap ride out cleanly. Superseded by
// LLM_PRIMARY=gemini; kept as a fallback routing mode. Set LLM_MISTRAL_ONLY=false to restore the
// multi-provider/dual routing.
const MISTRAL_ONLY = !PRIMARY_IS_BEDROCK && !PRIMARY_IS_GEMINI && process.env.LLM_MISTRAL_ONLY !== "false";

// LOCAL Ollama — the one free resource with NO rate limit and NO daily cap (it runs on this
// machine). The whole confidence-instability problem was providers timing out to 0 under
// Mistral's 50-req/min limit; a local call CANNOT be throttled, so routing the fact-grounded
// reasoning tasks here means they never time out and never zero the score. It's slower per call
// than a hosted API, but it can't be rate-limited — reliability over speed. Proven to do forced
// tool-calls (llama3.1:8b named Salesforce/HubSpot/Zoho for a CRM in one shot). Also OFFLOADS
// those calls from Mistral, easing its rate pressure for everything else.
const OLLAMA: LLMAssignment = { provider: "ollama", model: process.env.OLLAMA_MODEL ?? "llama3.1:8b" };
// Master switch: route the fact-grounded research/reasoning tasks to local Ollama. On by
// default because it's the free way to stop the rate-limit timeouts. Set LLM_LOCAL_RESEARCH=false
// to send them back to Mistral (e.g. if a fast uncapped hosted provider is configured).
const LOCAL_RESEARCH = !PRIMARY_IS_BEDROCK && !PRIMARY_IS_GEMINI && process.env.LLM_LOCAL_RESEARCH !== "false";
// The reasoning tasks that work from already-extracted facts. Under LLM_PRIMARY=bedrock they go to
// Bedrock Claude; under =gemini to Gemini; otherwise the older split — local Ollama or Mistral.
const FACT_REASONING: LLMAssignment = PRIMARY_IS_BEDROCK ? BEDROCK_PRIMARY : PRIMARY_IS_GEMINI ? GEMINI_PRIMARY : LOCAL_RESEARCH ? OLLAMA : MISTRAL;

const DEFAULT_ASSIGNMENT: LLMAssignment = PRIMARY_IS_BEDROCK ? BEDROCK_PRIMARY : PRIMARY_IS_GEMINI ? GEMINI_PRIMARY : MISTRAL;

const GEMINI: LLMAssignment = PRIMARY_IS_BEDROCK ? BEDROCK_PRIMARY : PRIMARY_IS_GEMINI ? GEMINI_PRIMARY : MISTRAL_ONLY ? MISTRAL : { provider: "google", model: process.env.GEMINI_MODEL ?? "gemini-2.0-flash" };
// "dual" would fire OpenRouter + Mistral concurrently; under a single-primary mode (bedrock/gemini)
// it's one call to that primary (no wasted legs, the fallback chain still covers failures), and
// under MISTRAL_ONLY just Mistral. Restored to real dual when no single-primary mode is active.
const DUAL: LLMAssignment = PRIMARY_IS_BEDROCK ? BEDROCK_PRIMARY : PRIMARY_IS_GEMINI ? GEMINI_PRIMARY : MISTRAL_ONLY ? MISTRAL : { provider: "dual", model: "auto" };
// Deep-research tasks (the 20 agents + research providers). Gemini-primary by default.
const DEEP_RESEARCH: LLMAssignment = DUAL;

// Decision Engine steps — the USER-VISIBLE strategy output (business summary, ranked
// recommendations, tradeoffs, strategy synthesis). Under a single-primary mode they ride the
// primary (Bedrock/Gemini) like everything else, so the strategy confidence a user sees is built
// on the SAME model as the research it's derived from — the whole point of paying for Bedrock. In
// the OLDER free-tier routing (no single primary) they stay pinned to MISTRAL for the historical
// reason below: on the free tier these run last, after ~30 calls have saturated the shared primary's
// per-minute budget, and would rate-limit to a placeholder summary; Mistral's separate rate budget
// kept the visible summary reliable. That failure mode doesn't exist on paid Bedrock (not per-minute
// throttled), so pinning there would just cap the visible confidence at the weaker model for no gain.
const DECISION: LLMAssignment = PRIMARY_IS_BEDROCK ? BEDROCK_PRIMARY : PRIMARY_IS_GEMINI ? GEMINI_PRIMARY : MISTRAL;

const TASK_MODEL_REGISTRY: Record<string, LLMAssignment> = {
  // 3 composite super-agents (the default roster) — each does several of the individual agents'
  // jobs in ONE structured call, cutting the agent layer from 20 calls to 3. They produce large
  // multi-schema JSON, so they get DEEP_RESEARCH like the producers they absorb. reviewer-agent
  // is the merged critic+compliance reviewer that runs last over the producer proposals.
  "strategy-agent": DEEP_RESEARCH,
  "creative-offer-agent": DEEP_RESEARCH,
  "reviewer-agent": DEEP_RESEARCH,

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

  // Decision Engine steps — the USER-VISIBLE strategy output. Ride the primary (DECISION) so the
  // strategy confidence a user sees is built on the same model as its research; only the older
  // free-tier routing keeps the historical MISTRAL pin (see DECISION's definition for why).
  "decision-summary": DECISION,
  "enrichment-proof-points": DECISION,
  "enrichment-regional-depth": DECISION,
  "tradeoff-analysis": DECISION,
  "recommendation-generation": DECISION,
  "strategy-synthesis": DECISION,

  // Research providers — 70B for accurate data extraction
  "app-store": DEEP_RESEARCH,
  audience: DEEP_RESEARCH,
  "ad-library": DEEP_RESEARCH,
  competitor: FACT_REASONING,
  company: FACT_REASONING,
  autocomplete: DEEP_RESEARCH,
  "backlink-authority": DEEP_RESEARCH,
  funding: DEEP_RESEARCH,
  "serp-features": DEEP_RESEARCH,
  "hiring-signals": DEEP_RESEARCH,
  "content-marketing": DEEP_RESEARCH,
  "legal-regulatory": DEEP_RESEARCH,
  "local-presence": DEEP_RESEARCH,
  market: FACT_REASONING,
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

  // Intelligence Engines + crawl fact extraction — the fact-grounded reasoning tasks that kept
  // TIMING OUT to 0 under Mistral's rate limit. Routed to LOCAL Ollama (FACT_REASONING): it
  // can't be rate-limited, so these complete reliably instead of intermittently zeroing the
  // score, and they stop competing for Mistral's request budget.
  "audience-intelligence": FACT_REASONING,
  "competitor-intelligence-discovery": FACT_REASONING,
  "competitor-intelligence-enrichment": FACT_REASONING,
  "creative-intelligence": GEMINI,
  "market-intelligence": FACT_REASONING,
  "pricing-intelligence": GEMINI,
  "landing-page-intelligence": DEEP_RESEARCH,
  // The single most valuable call in the run (its facts replace ~17 downstream retrievals) and
  // it's on the CRITICAL PATH — the whole fact-first pipeline is skipped if it doesn't return in
  // time, and then every provider falls back to (flaky) web search and the CORE ones time out to
  // 0. Uses the shared primary (Bedrock). This gating call was historically pinned to MISTRAL to
  // keep it off a saturated free-tier budget, but we now depend fully on Bedrock — which has ample
  // throughput and no free-tier rate storm — so there's no reason to route it elsewhere.
  "crawl-fact-extraction": DEFAULT_ASSIGNMENT,
  "ad-creative-analysis": DEEP_RESEARCH,

  // Meta Ads keyword validation & interest mining
  "meta-interest-mining": DEEP_RESEARCH,
  "meta-keyword-validation": DEEP_RESEARCH,
  "budget-market-calibration": DEEP_RESEARCH,
};

const VALID_PROVIDERS = new Set<string>(["openrouter", "ollama", "mistral", "google", "bedrock", "dual"]);

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
