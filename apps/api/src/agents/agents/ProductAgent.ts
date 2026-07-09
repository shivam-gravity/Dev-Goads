import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, ProductAgentOutput, ResearchContext } from "../types/index.js";

const PRODUCT_AGENT_TOOL = {
  name: "emit_product_agent_result",
  description: "Return a synthesized product identity and positioning.",
  input_schema: {
    type: "object" as const,
    properties: {
      productName: { type: "string" },
      category: { type: "string" },
      summary: { type: "string", description: "2-3 sentences on what the product is and who it's for" },
      valueProposition: { type: "string" },
      keyFeatures: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
    },
    required: ["productName", "category", "summary", "valueProposition", "keyFeatures"],
  },
};

const productAgentSchema: z.ZodType<ProductAgentOutput> = z.object({
  productName: z.string(),
  category: z.string(),
  summary: z.string(),
  valueProposition: z.string(),
  keyFeatures: z.array(z.string()),
});

function fallback(context: ResearchContext): ProductAgentOutput {
  return {
    productName: context.company?.name ?? context.website?.title ?? context.url,
    category: "General business",
    summary: context.website?.description ?? `A business operating at ${context.url}.`,
    valueProposition: "Distinct offering worth exploring further.",
    keyFeatures: context.keywords?.headings?.slice(0, 4) ?? ["Core product/service"],
  };
}

/** Synthesizes product identity/positioning from website + company + keyword research —
 * consumes ResearchContext only, independent of every other agent. */
export class ProductAgent implements AIAgent<ProductAgentOutput> {
  readonly name = "product-agent";
  readonly promptId = "product-agent";

  async execute(context: ResearchContext): Promise<AgentResult<ProductAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["website", "company", "keywords"] as const;
      const { data, promptVersion, usedFallback } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          website: JSON.stringify(context.website ?? {}),
          company: JSON.stringify(context.company ?? {}),
          keywords: JSON.stringify(context.keywords ?? {}),
        },
        tool: PRODUCT_AGENT_TOOL,
        schema: productAgentSchema,
        maxTokens: 768,
        fallback: () => fallback(context),
      });
      return {
        data,
        promptId: this.promptId,
        promptVersion,
        usedFallback,
        confidence: computeConfidence(context, [...fields], usedFallback),
        evidence: collectEvidence(context, [...fields]),
      };
    });
  }
}
