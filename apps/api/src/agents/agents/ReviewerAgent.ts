import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { loadVerifiedFacts, verifiedFactsForPrompt } from "../crawlFacts.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentExecuteInput, AgentResult, ResearchContext, ReviewerAgentOutput } from "../types/index.js";

const SEVERITY_ENUM = ["low", "medium", "high"] as const;
const RISK_ENUM = ["low", "medium", "high"] as const;

/**
 * Composite reviewer super-agent — does critic-agent + compliance-agent's jobs in ONE
 * structured LLM call. Like the individual reviewers it runs LAST (AgentCoordinator's
 * REVIEWER_AGENT_NAMES) so it reviews the exploded producer proposals via input.priorResults.
 * Exploded back into the legacy `results["critic-agent"]`/`["compliance-agent"]` keys by
 * AgentCoordinator.deriveLegacyAgentResults.
 */
const REVIEWER_AGENT_TOOL = {
  name: "emit_reviewer_agent_result",
  description: "Return both an adversarial quality/grounding review (critic) and an ad-policy compliance review of the proposals.",
  input_schema: {
    type: "object" as const,
    properties: {
      critic: {
        type: "object",
        properties: {
          overallScore: { type: "integer", minimum: 0, maximum: 100, description: "0-100, how trustworthy/well-grounded the proposals are overall" },
          issues: {
            type: "array",
            minItems: 0,
            maxItems: 10,
            items: { type: "object", properties: { agent: { type: "string" }, severity: { type: "string", enum: [...SEVERITY_ENUM] }, issue: { type: "string" } }, required: ["agent", "severity", "issue"] },
          },
          missingData: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 8, description: "Research dimensions that were missing/null and limited review quality" },
          recommendation: { type: "string", description: "1-2 sentences: proceed as-is, proceed with caveats, or don't proceed" },
        },
        required: ["overallScore", "issues", "missingData", "recommendation"],
      },
      compliance: {
        type: "object",
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
                issue: { type: "string", description: "The specific policy concern (unsubstantiated claim, restricted category, missing disclosure)" },
                suggestion: { type: "string", description: "A concrete rewrite/fix" },
              },
              required: ["agent", "severity", "issue", "suggestion"],
            },
          },
          restrictedCategoryConcerns: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5, description: "If the business/industry falls into a restricted ad category (finance, health, gambling, alcohol, weapons, adult), name the specific platform policy implications" },
          recommendation: { type: "string", description: "1-2 sentences: safe to launch as-is, launch with the suggested fixes, or hold for legal/policy review" },
        },
        required: ["overallRisk", "flags", "restrictedCategoryConcerns", "recommendation"],
      },
    },
    required: ["critic", "compliance"],
  },
};

const reviewerAgentSchema: z.ZodType<ReviewerAgentOutput> = z.object({
  critic: z.object({
    overallScore: z.number().min(0).max(100),
    issues: z.array(z.object({ agent: z.string(), severity: z.enum(SEVERITY_ENUM), issue: z.string() })),
    missingData: z.array(z.string()),
    recommendation: z.string(),
  }),
  compliance: z.object({
    overallRisk: z.enum(RISK_ENUM),
    flags: z.array(z.object({ agent: z.string(), severity: z.enum(SEVERITY_ENUM), issue: z.string(), suggestion: z.string() })),
    restrictedCategoryConcerns: z.array(z.string()),
    recommendation: z.string(),
  }),
});

function fallback(proposals: Record<string, unknown>): ReviewerAgentOutput {
  const hasProposals = Object.keys(proposals).length > 0;
  return {
    critic: hasProposals
      ? { overallScore: 40, issues: [{ agent: "reviewer-agent", severity: "medium", issue: "No live model available — this is an unreviewed placeholder score" }], missingData: [], recommendation: "Re-run once a model is available for a substantive review." }
      : { overallScore: 0, issues: [{ agent: "reviewer-agent", severity: "high", issue: "No agent proposals were supplied to review" }], missingData: [], recommendation: "Run at least one producer agent before requesting a review." },
    compliance: hasProposals
      ? { overallRisk: "medium", flags: [{ agent: "reviewer-agent", severity: "medium", issue: "No live model available — this is an unreviewed placeholder", suggestion: "Re-run once a model is available" }], restrictedCategoryConcerns: [], recommendation: "Re-run once a model is available for a substantive compliance review." }
      : { overallRisk: "medium", flags: [{ agent: "reviewer-agent", severity: "medium", issue: "No proposals were supplied to review", suggestion: "Run at least one producer agent before requesting a compliance review" }], restrictedCategoryConcerns: [], recommendation: "Re-run once agent proposals exist to review." },
  };
}

const ALL_CONTEXT_FIELDS = [
  "website", "market", "technology", "competitors", "keywords", "audience", "company", "news",
  "socialMedia", "reviews", "funding", "hiringSignals", "contentMarketing", "backlinkAuthority",
  "appStore", "videoPresence", "localPresence", "partnerships", "legalRegulatory",
] as const;

/**
 * Composite reviewer super-agent (critic + compliance). Takes ResearchContext as its primary
 * input (independently testable with a context fixture + fabricated priorResults), with the
 * real review living in input.priorResults — exactly like the two individual reviewers.
 */
export class ReviewerAgent implements AIAgent<ReviewerAgentOutput> {
  readonly name = "reviewer-agent";
  readonly promptId = "reviewer-agent";

  async execute(context: ResearchContext, input?: AgentExecuteInput): Promise<AgentResult<ReviewerAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const proposals = Object.fromEntries(Object.entries(input?.priorResults ?? {}).map(([name, result]) => [name, result.data]));
      const contextSummary = Object.fromEntries(ALL_CONTEXT_FIELDS.map((f) => [f, context[f] != null]));
      const verifiedFacts = await loadVerifiedFacts(context);

      const { data, promptVersion, usedFallback, modelSource } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          context: JSON.stringify(contextSummary),
          verifiedFacts: verifiedFactsForPrompt(verifiedFacts),
          company: JSON.stringify(context.company ?? {}),
          market: JSON.stringify(context.market ?? {}),
          legalRegulatory: JSON.stringify(context.legalRegulatory ?? {}),
          proposals: JSON.stringify(proposals),
        },
        tool: REVIEWER_AGENT_TOOL,
        schema: reviewerAgentSchema,
        maxTokens: 2048,
        fallback: () => fallback(proposals),
      });

      const evidence = [
        ...collectEvidence(context, [...ALL_CONTEXT_FIELDS]),
        ...Object.keys(proposals).map((agent) => ({ source: agent, detail: `Reviewed ${agent}'s proposed output (quality + compliance)` })),
        ...(verifiedFacts.length > 0 ? [{ source: "crawl-facts", detail: `Cross-checked proposals against ${verifiedFacts.length} verified facts from the site crawl` }] : []),
      ];

      return {
        data,
        promptId: this.promptId,
        promptVersion,
        usedFallback,
        modelSource,
        confidence: Object.keys(proposals).length === 0 ? 0.1 : computeConfidence(context, [...ALL_CONTEXT_FIELDS], usedFallback),
        evidence,
      };
    });
  }
}
