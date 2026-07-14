import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { CompanyData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, runProviderStep, webSearchThenStructure } from "./support.js";

const COMPANY_TOOL = {
  name: "emit_company_profile",
  description: "Return a structured company profile for this business.",
  input_schema: {
    type: "object" as const,
    properties: {
      name: { type: "string" },
      summary: { type: "string", description: "2-3 sentences on what the company does" },
      foundedYear: { type: "string" },
      headquarters: { type: "string" },
      employeeRange: { type: "string", description: "e.g. \"11-50\", \"1,000-5,000\"" },
      fundingStage: { type: "string", description: "e.g. \"Bootstrapped\", \"Series B\", \"Public\"" },
      revenueEstimate: { type: "string", description: "Best-effort revenue estimate from public signals, e.g. \"$5M-$10M ARR\", or \"Unknown\" if nothing credible surfaced" },
      deploymentModel: { type: "string", description: "e.g. \"Cloud/SaaS (multi-tenant)\", \"Self-hosted/on-prem\", \"Hybrid\"" },
      pricingModel: { type: "string", description: "e.g. \"Per-seat subscription\", \"Usage-based\", \"Freemium + paid tiers\"" },
      technologyStack: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 10, description: "Named technologies/platforms this company builds on or is known to use" },
      integrations: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 10, description: "Named integrations/ecosystem partners the product connects with" },
      salesMotion: { type: "string", description: "e.g. \"Self-serve/PLG\", \"Inside sales\", \"Enterprise/field sales\"" },
      customerLifecycle: { type: "string", description: "How a customer typically moves from trial/first purchase to renewal/expansion" },
    },
    required: ["name", "summary"],
  },
};

/** Company profile (identity, size, funding, HQ) — independent of every other provider,
 * derived only from the target URL/business name via a live web search. */
export class CompanyProvider implements ResearchProvider<CompanyData> {
  readonly name = "company";
  readonly priority = 30;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<CompanyData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const label = input.businessName ? `"${input.businessName}" (${input.url})` : input.url;
      const { status, data, citations } = await webSearchThenStructure<CompanyData>({
        maxTokens: 768,
        tool: COMPANY_TOOL,
        searchPrompt: `Research the company behind ${label}. Find: legal/brand name, what it does, founding year, headquarters location, employee count range, funding stage/ownership (bootstrapped, VC-backed, public, etc), a best-effort revenue estimate, deployment model (cloud/self-hosted/hybrid), pricing model (per-seat/usage-based/freemium), technology stack, named integrations/ecosystem partners, sales motion (self-serve vs. sales-led), and typical customer lifecycle.`,
        structurePrompt: (narrative) => `Using this web research, produce a structured company profile.\n\nWeb research findings:\n${narrative}\n\nURL: ${input.url}`,
        fallback: () => ({
          name: input.businessName ?? input.url,
          summary: `Company profile for ${input.url} — no live research performed.`,
          dataSource: "",
        }),
      });
      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
