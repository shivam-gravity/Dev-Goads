import { logger } from "../modules/logger/logger.js";
import { createAIAgents } from "./agents/index.js";
import type { AIAgent } from "./interfaces/AIAgent.js";
import type { AgentResult, ResearchContext } from "./types/index.js";

export const MAX_AGENT_ATTEMPTS = 2;
export const AGENT_RETRY_DELAY_MS = 500;

// Reviewer agents take `{ priorResults }` and review what the producer agents proposed,
// rather than producing a fresh synthesis of their own — CriticAgent (quality/grounding),
// ComplianceAgent (ad-policy risk), and the composite ReviewerAgent (both at once) all fit
// this shape. Generalized to a set (not a single hardcoded name) specifically so adding a
// reviewer is a one-line change here, not a rewrite of runAgentCoordinator's control flow.
const REVIEWER_AGENT_NAMES = new Set(["critic-agent", "compliance-agent", "reviewer-agent"]);

/**
 * Maps each composite super-agent's bundled result onto the legacy per-agent result keys the
 * rest of the pipeline (strategyEngine, persistence, campaign build) reads — e.g. strategy-agent's
 * `{campaign, audience, keyword, budget}` becomes four results keyed "campaign-agent",
 * "audience-agent", "keyword-agent", "budget-agent". Each value is the field on the composite's
 * `data` object that carries that sub-agent's output. See agents/agents/index.ts for why the
 * agent layer is 3 composite calls instead of 20 individual ones.
 */
const COMPOSITE_RESULT_MAP: Record<string, Record<string, string>> = {
  "strategy-agent": { "campaign-agent": "campaign", "audience-agent": "audience", "keyword-agent": "keyword", "budget-agent": "budget" },
  "creative-offer-agent": { "creative-agent": "creative", "pricing-offer-agent": "pricingOffer", "objection-handling-agent": "objectionHandling" },
  "reviewer-agent": { "critic-agent": "critic", "compliance-agent": "compliance" },
};

/**
 * Explodes one settled AgentResult into the legacy-keyed results it stands in for. A composite
 * agent's result becomes several entries (one per sub-agent, each carrying that sub-part of the
 * composite's `data` but sharing the composite's confidence/evidence/timing envelope). Any
 * non-composite agent (the still-supported full 20-agent roster, and every test fake) passes
 * through unchanged as a single `[name, result]` entry — so this is a no-op for them and the
 * coordinator's behavior is identical when composites aren't in use.
 */
function deriveLegacyAgentResults(result: AgentResult<unknown>): [string, AgentResult<unknown>][] {
  const mapping = COMPOSITE_RESULT_MAP[result.agent];
  if (!mapping) return [[result.agent, result]];

  const bundle = (result.data ?? {}) as Record<string, unknown>;
  return Object.entries(mapping).map(([legacyName, field]) => [
    legacyName,
    { ...result, agent: legacyName, promptId: legacyName, data: bundle[field] ?? {} },
  ]);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AgentCoordinatorOptions {
  /** Injectable for tests — defaults to the real createAIAgents() (all 10 agents). */
  agents?: AIAgent<unknown>[];
  /** Called once per agent settlement (including the critic) with (completed, total, agentName) —
   * same shape as ResearchOrchestrator's onProgress, so a worker can wire both to job.updateProgress
   * (the count) and a live-progress record (the name) with one consistent meaning. */
  onProgress?: (completed: number, total: number, agentName?: string) => void | Promise<void>;
}

export interface AgentPipelineResult {
  /** Every agent's result, keyed by agent name (e.g. "product-agent"). */
  results: Record<string, AgentResult<unknown>>;
  /** Names in the order they were run — the 9 producers (parallel, order not meaningful
   * among themselves) followed by critic-agent (always last). */
  order: string[];
}

/**
 * Runs one agent to completion, retrying up to MAX_AGENT_ATTEMPTS times if it throws
 * (an agent's own degrade-to-fallback path returns normally, never throws — see
 * agents/support.ts's callAgentModel/runAgentStep — so a throw here means something
 * unexpected: a network blip, an OpenAI 5xx, etc., worth one retry rather than failing
 * the whole pipeline). Mirrors ResearchOrchestrator's runProviderWithRetry.
 */
async function runAgentWithRetry(
  agent: AIAgent<unknown>,
  context: ResearchContext,
  input: Parameters<AIAgent<unknown>["execute"]>[1]
): Promise<AgentResult<unknown>> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_AGENT_ATTEMPTS; attempt++) {
    try {
      return await agent.execute(context, input);
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_AGENT_ATTEMPTS) {
        logger.warn(`Agent ${agent.name} failed on attempt ${attempt}/${MAX_AGENT_ATTEMPTS} — retrying`, err);
        await sleep(AGENT_RETRY_DELAY_MS * attempt);
      }
    }
  }
  throw lastErr;
}

/**
 * The AI Agent Coordinator — the missing link between the Knowledge Aggregator's
 * ResearchContext and a buildable campaign. Fans the 18 "producer" agents (Product,
 * Audience, Competitor, Market, Keyword, Creative, Budget, Persona, Campaign, Landing
 * Page, Pricing/Offer, Localization, SEO Content, Seasonality/Timing, Channel Placement,
 * Funnel/Retargeting, Objection Handling, Forecasting/KPI) out in parallel off the same
 * ResearchContext (mirrors ResearchOrchestrator's provider fan-out), then runs both
 * reviewer agents (CriticAgent, ComplianceAgent) — also in parallel with each other, since
 * neither depends on the other, only on the producers' shared `priorResults` snapshot —
 * so each can review what the 18 producers proposed. See CriticAgent's own doc comment,
 * which names this exact two-phase shape as its intended calling convention.
 *
 * Deliberately does not import or construct agents itself beyond createAIAgents() —
 * no agent's prompt/logic is touched here, this file only sequences existing,
 * independently-tested agents.
 */
export async function runAgentCoordinator(
  context: ResearchContext,
  options: AgentCoordinatorOptions = {}
): Promise<AgentPipelineResult> {
  const allAgents = options.agents ?? (createAIAgents() as AIAgent<unknown>[]);
  const reviewerAgents = allAgents.filter((a) => REVIEWER_AGENT_NAMES.has(a.name));
  const producerAgents = allAgents.filter((a) => !REVIEWER_AGENT_NAMES.has(a.name));
  const total = allAgents.length;

  let completed = 0;
  const reportProgress = async (agentName: string) => {
    completed += 1;
    await options.onProgress?.(completed, total, agentName);
  };

  const producerResults = await Promise.all(
    producerAgents.map(async (agent) => {
      const result = await runAgentWithRetry(agent, context, undefined);
      await reportProgress(agent.name);
      return result;
    })
  );

  // Explode each producer's result into the legacy per-agent keys it stands in for (a
  // composite super-agent → several keys; a plain agent → itself). This is what lets 3
  // composite producer calls populate the exact `results["campaign-agent"]`-style shape the
  // rest of the pipeline reads — AND it's what the reviewer sees below, so the reviewer
  // reviews the individual proposals (campaign, audience, …) rather than one opaque bundle.
  const results: Record<string, AgentResult<unknown>> = {};
  const order: string[] = [];
  for (const result of producerResults) {
    for (const [name, derived] of deriveLegacyAgentResults(result)) {
      results[name] = derived;
      order.push(name);
    }
  }

  if (reviewerAgents.length > 0) {
    // Snapshot, not a live reference — `results` gets each reviewer's own entry added
    // right after this call, and a reviewer is meant to review what came before it,
    // never itself (a shared mutable reference here would let that leak through to
    // anything holding onto input.priorResults after execute() resolves). Reviewers run
    // in parallel with each other (both only read this same snapshot, neither writes
    // anything the other reads), same fan-out shape as the producers above.
    const priorResultsSnapshot = { ...results };
    const reviewerResults = await Promise.all(
      reviewerAgents.map(async (agent) => {
        const result = await runAgentWithRetry(agent, context, { priorResults: priorResultsSnapshot });
        await reportProgress(agent.name);
        return result;
      })
    );
    // Reviewers explode too (the composite reviewer-agent → critic-agent + compliance-agent).
    for (const result of reviewerResults) {
      for (const [name, derived] of deriveLegacyAgentResults(result)) {
        results[name] = derived;
        order.push(name);
      }
    }
  }

  return { results, order };
}
