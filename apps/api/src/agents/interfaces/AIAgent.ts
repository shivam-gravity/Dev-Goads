import type { AgentExecuteInput, AgentResult, ResearchContext } from "../types/index.js";

/**
 * The contract all 10 agents implement. `execute` always takes the aggregated
 * ResearchContext (the Research Orchestrator's output) as its primary input — agents
 * never call each other directly, so each one is independently testable by constructing
 * a ResearchContext fixture and calling execute() alone, with no dependency graph to
 * stand up first. `promptId` names the entry this agent looks up in the Prompt Registry
 * (see prompts/PromptRegistry.ts) — never a hardcoded string inline in execute().
 */
export interface AIAgent<T> {
  readonly name: string;
  readonly promptId: string;
  execute(context: ResearchContext, input?: AgentExecuteInput): Promise<AgentResult<T>>;
}
