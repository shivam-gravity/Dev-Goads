import { logger } from "../modules/logger/logger.js";
import { createAIAgents } from "./agents/index.js";
import type { AIAgent } from "./interfaces/AIAgent.js";
import type { AgentResult, ResearchContext } from "./types/index.js";

export const MAX_AGENT_ATTEMPTS = 2;
export const AGENT_RETRY_DELAY_MS = 500;

const CRITIC_AGENT_NAME = "critic-agent";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface AgentCoordinatorOptions {
  /** Injectable for tests — defaults to the real createAIAgents() (all 10 agents). */
  agents?: AIAgent<unknown>[];
  /** Called once per agent settlement (including the critic) with (completed, total) —
   * same shape as ResearchOrchestrator's onProgress, so a worker can wire both to
   * job.updateProgress with one consistent meaning. */
  onProgress?: (completed: number, total: number) => void | Promise<void>;
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
 * ResearchContext and a buildable campaign. Fans the 9 "producer" agents (Product,
 * Audience, Competitor, Market, Keyword, Creative, Budget, Persona, Campaign) out in
 * parallel off the same ResearchContext (mirrors ResearchOrchestrator's provider
 * fan-out), then runs CriticAgent last with `{ priorResults }` so it can review what
 * the other 9 proposed — see CriticAgent's own doc comment, which names this exact
 * two-phase shape as its intended calling convention.
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
  const criticAgent = allAgents.find((a) => a.name === CRITIC_AGENT_NAME);
  const producerAgents = allAgents.filter((a) => a.name !== CRITIC_AGENT_NAME);
  const total = allAgents.length;

  let completed = 0;
  const reportProgress = async () => {
    completed += 1;
    await options.onProgress?.(completed, total);
  };

  const producerResults = await Promise.all(
    producerAgents.map(async (agent) => {
      const result = await runAgentWithRetry(agent, context, undefined);
      await reportProgress();
      return result;
    })
  );

  const results: Record<string, AgentResult<unknown>> = {};
  for (const result of producerResults) results[result.agent] = result;

  const order = producerAgents.map((a) => a.name);

  if (criticAgent) {
    // Snapshot, not a live reference — `results` gets critic-agent's own entry added
    // right after this call, and CriticAgent is meant to review what came before it,
    // never itself (a shared mutable reference here would let that leak through to
    // anything holding onto input.priorResults after execute() resolves).
    const criticResult = await runAgentWithRetry(criticAgent, context, { priorResults: { ...results } });
    results[criticResult.agent] = criticResult;
    order.push(criticAgent.name);
    await reportProgress();
  }

  return { results, order };
}
