import "../prompts/definitions/index.js";
import { StrategyAgent } from "./StrategyAgent.js";
import { CreativeOfferAgent } from "./CreativeOfferAgent.js";
import { ReviewerAgent } from "./ReviewerAgent.js";
import type { AIAgent } from "../interfaces/AIAgent.js";

export { StrategyAgent } from "./StrategyAgent.js";
export { CreativeOfferAgent } from "./CreativeOfferAgent.js";
export { ReviewerAgent } from "./ReviewerAgent.js";

/**
 * The agent roster — 3 composite super-agents, each doing several marketing tasks in ONE
 * structured LLM call, so the agent layer costs 3 calls instead of the ~20 individual agents
 * it replaced:
 *   - strategy-agent        → campaign + audience(+personas) + keyword + budget  (producer)
 *   - creative-offer-agent  → creative + pricing-offer + objection-handling      (producer)
 *   - reviewer-agent        → critic + compliance                               (reviewer, runs last)
 *
 * Each composite emits a bundle of the existing per-task output types; AgentCoordinator's
 * deriveLegacyAgentResults() explodes those bundles back into the individual
 * `results["campaign-agent"]`-style keys the rest of the pipeline (strategyEngine, persistence,
 * campaign build) consumes — so downstream reads exactly what it always has, from 3 calls.
 */
export function createAIAgents(): AIAgent<unknown>[] {
  return [
    new StrategyAgent(),
    new CreativeOfferAgent(),
    new ReviewerAgent(),
  ] as AIAgent<unknown>[];
}
