import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentExecuteInput, AgentResult, CriticAgentOutput, ResearchContext } from "../types/index.js";

const SEVERITY_ENUM = ["low", "medium", "high"] as const;

const CRITIC_AGENT_TOOL = {
  name: "emit_critic_agent_result",
  description: "Return an adversarial review of the proposed agent outputs.",
  input_schema: {
    type: "object" as const,
    properties: {
      overallScore: { type: "integer", minimum: 0, maximum: 100, description: "0-100, how trustworthy/well-grounded the proposals are overall" },
      issues: {
        type: "array",
        minItems: 0,
        maxItems: 10,
        items: {
          type: "object",
          properties: { agent: { type: "string" }, severity: { type: "string", enum: [...SEVERITY_ENUM] }, issue: { type: "string" } },
          required: ["agent", "severity", "issue"],
        },
      },
      missingData: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8, description: "Research dimensions that were missing/null and limited review quality" },
      recommendation: { type: "string", description: "1-2 sentences: proceed as-is, proceed with caveats, or don't proceed" },
    },
    required: ["overallScore", "issues", "missingData", "recommendation"],
  },
};

const criticAgentSchema: z.ZodType<CriticAgentOutput> = z.object({
  overallScore: z.number().min(0).max(100),
  issues: z.array(z.object({ agent: z.string(), severity: z.enum(SEVERITY_ENUM), issue: z.string() })),
  missingData: z.array(z.string()),
  recommendation: z.string(),
});

function fallback(proposals: Record<string, unknown>): CriticAgentOutput {
  const agentNames = Object.keys(proposals);
  if (agentNames.length === 0) {
    return {
      overallScore: 0,
      issues: [{ agent: "critic-agent", severity: "high", issue: "No agent proposals were supplied to review" }],
      missingData: [],
      recommendation: "Run at least one other agent before requesting a critique.",
    };
  }
  return {
    overallScore: 40,
    issues: [{ agent: "critic-agent", severity: "medium", issue: "No live model available — this is an unreviewed placeholder score" }],
    missingData: [],
    recommendation: "Re-run once a model is available for a substantive review.",
  };
}

const ALL_CONTEXT_FIELDS = ["website", "market", "technology", "competitors", "keywords", "audience", "company", "news"] as const;

/**
 * The one agent that reviews OTHER agents' outputs rather than producing a fresh
 * synthesis — it still takes ResearchContext as its primary input (so it's independently
 * testable with just a context fixture and an empty/fabricated `priorResults` bag), but
 * its real job needs the second, optional `input.priorResults` parameter every other
 * agent ignores. Adversarial by design: the prompt explicitly asks it to find problems,
 * not validate them.
 */
export class CriticAgent implements AIAgent<CriticAgentOutput> {
  readonly name = "critic-agent";
  readonly promptId = "critic-agent";

  async execute(context: ResearchContext, input?: AgentExecuteInput): Promise<AgentResult<CriticAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const proposals = Object.fromEntries(Object.entries(input?.priorResults ?? {}).map(([name, result]) => [name, result.data]));
      const contextSummary = Object.fromEntries(ALL_CONTEXT_FIELDS.map((f) => [f, context[f] !== null]));

      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          context: JSON.stringify(contextSummary),
          proposals: JSON.stringify(proposals),
        },
        tool: CRITIC_AGENT_TOOL,
        schema: criticAgentSchema,
        maxTokens: 1024,
        fallback: () => fallback(proposals),
      });

      const evidence = [
        ...collectEvidence(context, [...ALL_CONTEXT_FIELDS]),
        ...Object.keys(proposals).map((agent) => ({ source: agent, detail: `Reviewed ${agent}'s proposed output` })),
      ];

      return {
        data,
        promptId: this.promptId,
        promptVersion,
        usedFallback,
        confidence: Object.keys(proposals).length === 0 ? 0.1 : computeConfidence(context, [...ALL_CONTEXT_FIELDS], usedFallback),
        evidence,
      };
    });
  }
}
