import { llm, runWebSearch } from "../../infra/llmClient.js";
import { callDecisionModel } from "./support.js";
import { hostnameOf } from "../providers/support.js";
import type { ResearchContext } from "../types/index.js";
import type { EnrichmentData, PricingTier, RegionalMarketDepth } from "./types.js";

/**
 * Enrichment Engine — closes specific, identified content gaps in what the 9 core research
 * providers capture: none of them have a pricing field, a named-customer/social-proof field,
 * a quantified-claims field, or country-level (as opposed to global) market depth. Rather
 * than modifying those providers (frozen) or ResearchContext's shape, this engine runs
 * alongside the rest of the Decision Engine, doing its own targeted live web search for
 * exactly these 4 things, additively. Never throws: degrades to empty results with zero
 * network calls when there's no OPENAI_API_KEY, same contract as every other engine here.
 */

const PROOF_POINTS_TOOL = {
  name: "emit_proof_points",
  description: "Return pricing tiers, named real customers, and quantified proof points found in research about this business.",
  input_schema: {
    type: "object" as const,
    properties: {
      pricingTiers: {
        type: "array",
        maxItems: 4,
        description: "Real or reasonably-estimated pricing tiers (empty array if genuinely unknown — never fabricate specific numbers with no basis)",
        items: {
          type: "object",
          properties: {
            tier: { type: "string", description: "e.g. \"SMB\", \"Mid-market\", \"Enterprise\"" },
            priceRange: { type: "string", description: "e.g. \"$10K-$150K/year\"" },
            details: { type: "string", description: "e.g. \"25-100 users\"" },
          },
          required: ["tier", "priceRange", "details"],
        },
      },
      notableCustomers: {
        type: "array", items: { type: "string" }, maxItems: 8,
        description: "Real named customers/clients this business publicly lists (case studies, logos, testimonials) — empty array if none found",
      },
      quantifiedProofPoints: {
        type: "array", items: { type: "string" }, maxItems: 6,
        description: "Specific quantified claims this business makes about itself, e.g. \"99% uptime\", \"30% faster launch cycles\" — empty array if none found",
      },
    },
    required: ["pricingTiers", "notableCustomers", "quantifiedProofPoints"],
  },
};

const REGIONAL_DEPTH_TOOL = {
  name: "emit_regional_depth",
  description: "Return country/region-specific market depth for the given region and category.",
  input_schema: {
    type: "object" as const,
    properties: {
      marketSize: { type: "string", description: "e.g. \"$1.24B in 2024\"" },
      growthRate: { type: "string", description: "e.g. \"16.08% CAGR through 2033\"" },
      policyDrivers: {
        type: "array", items: { type: "string" }, maxItems: 5,
        description: "Named regulatory/government/infrastructure drivers specific to this region — empty array if none found",
      },
    },
    required: ["policyDrivers"],
  },
};

function emptyEnrichment(): EnrichmentData {
  return { pricingTiers: [], notableCustomers: [], quantifiedProofPoints: [], regionalMarketDepth: null };
}

async function researchPricingAndProof(context: ResearchContext, businessLabel: string): Promise<Pick<EnrichmentData, "pricingTiers" | "notableCustomers" | "quantifiedProofPoints">> {
  const research = await runWebSearch(
    `Research "${businessLabel}" (${context.url}): (1) its pricing tiers/plans with price ranges if publicly listed, ` +
      `(2) real named customers or clients it publicly lists (case studies, "trusted by" logos, testimonials), ` +
      `(3) specific quantified claims it makes about its own product (uptime %, speed improvements, customer results). ` +
      `Only report what you actually find — leave a category empty rather than guessing.`
  );

  const structured = await callDecisionModel<Pick<EnrichmentData, "pricingTiers" | "notableCustomers" | "quantifiedProofPoints">>({
    taskName: "enrichment-proof-points",
    maxTokens: 1024,
    tool: PROOF_POINTS_TOOL,
    messages: [
      {
        role: "user",
        content: `From this research, extract pricing tiers, named customers, and quantified proof points for "${businessLabel}".\n\n${research.narrative || "(no live web research available)"}`,
      },
    ],
  });

  return structured ?? { pricingTiers: [], notableCustomers: [], quantifiedProofPoints: [] };
}

async function researchRegionalDepth(context: ResearchContext, businessLabel: string): Promise<RegionalMarketDepth | null> {
  const region = context.market?.recommendedRegion;
  if (!region) return null;

  const category = context.company?.summary ?? context.market?.trends.join(", ") ?? businessLabel;
  const research = await runWebSearch(
    `Research the market for "${category}" specifically in ${region}: market size, growth rate/CAGR, and any named government ` +
      `policy, regulatory, or infrastructure drivers specific to ${region} (not global trends).`
  );

  const structured = await callDecisionModel<{ marketSize?: string; growthRate?: string; policyDrivers: string[] }>({
    taskName: "enrichment-regional-depth",
    maxTokens: 512,
    tool: REGIONAL_DEPTH_TOOL,
    messages: [
      {
        role: "user",
        content: `From this research, extract region-specific market depth for ${region}.\n\n${research.narrative || "(no live web research available)"}`,
      },
    ],
  });
  if (!structured) return null;

  return { region, marketSize: structured.marketSize, growthRate: structured.growthRate, policyDrivers: structured.policyDrivers };
}

/**
 * Runs both enrichment lookups concurrently. Best-effort at every level: no API key -> empty
 * result immediately; a failed/timed-out web search or malformed structured response degrades
 * to empty for that one piece rather than throwing, since this whole engine is additive
 * polish on top of the core Decision Engine, never something the rest of it depends on.
 */
export async function enrichBusinessContext(context: ResearchContext): Promise<EnrichmentData> {
  if (!llm) return emptyEnrichment();
  const businessLabel = context.company?.name ?? hostnameOf(context.url);

  const [proofPoints, regionalMarketDepth] = await Promise.all([
    researchPricingAndProof(context, businessLabel).catch(() => ({ pricingTiers: [] as PricingTier[], notableCustomers: [] as string[], quantifiedProofPoints: [] as string[] })),
    researchRegionalDepth(context, businessLabel).catch(() => null),
  ]);

  return { ...proofPoints, regionalMarketDepth };
}
