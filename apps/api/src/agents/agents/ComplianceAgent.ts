import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentExecuteInput, AgentResult, ComplianceAgentOutput, ResearchContext } from "../types/index.js";

const SEVERITY_ENUM = ["low", "medium", "high"] as const;
const RISK_ENUM = ["low", "medium", "high"] as const;

const COMPLIANCE_AGENT_TOOL = {
  name: "emit_compliance_agent_result",
  description: "Return an ad-policy compliance review of the proposed creative/campaign copy.",
  input_schema: {
    type: "object" as const,
    properties: {
      overallRisk: { type: "string", enum: [...RISK_ENUM], description: "Overall Meta/Google ad-policy rejection risk" },
      flags: {
        type: "array",
        minItems: 0,
        maxItems: 10,
        items: {
          type: "object",
          properties: {
            agent: { type: "string", description: "Which proposal this flag applies to, e.g. 'campaign-agent'" },
            severity: { type: "string", enum: [...SEVERITY_ENUM] },
            issue: { type: "string", description: "The specific policy concern (e.g. unsubstantiated claim, restricted category, missing disclosure)" },
            suggestion: { type: "string", description: "A concrete rewrite/fix" },
          },
          required: ["agent", "severity", "issue", "suggestion"],
        },
      },
      restrictedCategoryConcerns: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5, description: "If the business/industry itself falls into a restricted ad category (finance, health, gambling, alcohol, weapons, adult), name the specific platform policy implications" },
      recommendation: { type: "string", description: "1-2 sentences: safe to launch as-is, launch with the suggested fixes, or hold for legal/policy review" },
    },
    required: ["overallRisk", "flags", "restrictedCategoryConcerns", "recommendation"],
  },
};

const complianceAgentSchema: z.ZodType<ComplianceAgentOutput> = z.object({
  overallRisk: z.enum(RISK_ENUM),
  flags: z.array(z.object({ agent: z.string(), severity: z.enum(SEVERITY_ENUM), issue: z.string(), suggestion: z.string() })),
  restrictedCategoryConcerns: z.array(z.string()),
  recommendation: z.string(),
});

function fallback(proposals: Record<string, unknown>): ComplianceAgentOutput {
  if (Object.keys(proposals).length === 0) {
    return {
      overallRisk: "medium",
      flags: [{ agent: "compliance-agent", severity: "medium", issue: "No proposals were supplied to review", suggestion: "Run at least one creative/campaign agent before requesting a compliance review" }],
      restrictedCategoryConcerns: [],
      recommendation: "Re-run once agent proposals exist to review.",
    };
  }
  return {
    overallRisk: "medium",
    flags: [{ agent: "compliance-agent", severity: "medium", issue: "No live model available — this is an unreviewed placeholder", suggestion: "Re-run once a model is available" }],
    restrictedCategoryConcerns: [],
    recommendation: "Re-run once a model is available for a substantive compliance review.",
  };
}

const ALL_CONTEXT_FIELDS = ["company", "market", "legalRegulatory"] as const;

/**
 * The second reviewer agent (alongside CriticAgent) — reviews the OTHER agents' proposed
 * ad copy/campaign structure for real Meta/Google ad-policy red flags (unsubstantiated
 * claims, restricted categories, missing disclosures, misleading urgency) rather than
 * quality/grounding issues, which is CriticAgent's job. Runs the same way CriticAgent
 * does: takes ResearchContext as its primary input (independently testable with just a
 * context fixture and a fabricated `priorResults`), with the real review living in the
 * optional `input.priorResults` every other producer agent ignores.
 */
export class ComplianceAgent implements AIAgent<ComplianceAgentOutput> {
  readonly name = "compliance-agent";
  readonly promptId = "compliance-agent";

  async execute(context: ResearchContext, input?: AgentExecuteInput): Promise<AgentResult<ComplianceAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const proposals = Object.fromEntries(Object.entries(input?.priorResults ?? {}).map(([name, result]) => [name, result.data]));

      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          company: JSON.stringify(context.company ?? {}),
          market: JSON.stringify(context.market ?? {}),
          legalRegulatory: JSON.stringify(context.legalRegulatory ?? {}),
          proposals: JSON.stringify(proposals),
        },
        tool: COMPLIANCE_AGENT_TOOL,
        schema: complianceAgentSchema,
        maxTokens: 1024,
        fallback: () => fallback(proposals),
      });

      const evidence = [
        ...collectEvidence(context, [...ALL_CONTEXT_FIELDS]),
        ...Object.keys(proposals).map((agent) => ({ source: agent, detail: `Reviewed ${agent}'s proposed output for policy compliance` })),
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
