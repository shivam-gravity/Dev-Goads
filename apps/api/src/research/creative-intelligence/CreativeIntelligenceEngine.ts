import { llm, runStructured, runWebSearch } from "../../infra/llmClient.js";
import { hostnameOf } from "../providers/support.js";
import { writeMemory } from "../memory/MemoryCoordinator.js";
import type { Citation } from "../../types/index.js";

/**
 * Creative Intelligence — analyzes competitors' actual ad/marketing creative (messaging,
 * CTAs, tone, hooks, offers, positioning, visual themes where public sources describe
 * them) and synthesizes messaging gaps, differentiation opportunities, and concrete
 * creative recommendations for the business itself. Takes a competitor list as input
 * (e.g. from runCompetitorIntelligence) rather than discovering competitors itself — this
 * engine's job is analyzing creative, not finding competitors.
 */

export interface CreativeIntelligenceInput {
  url: string;
  businessName?: string;
  industry?: string;
  workspaceId: string;
  businessId?: string;
  /** Names (and optionally URLs) of competitors to analyze — the caller supplies these,
   * typically from a prior Competitor Intelligence run. */
  competitors: { name: string; url?: string }[];
}

export interface CompetitorCreativeAnalysis {
  name: string;
  messaging: string;
  ctas: string[];
  tone: string;
  hooks: string[];
  offers: string[];
  positioning: string;
  visualThemes: string[];
  citations: Citation[];
  confidence: number;
}

export interface CreativeIntelligenceReport {
  businessUrl: string;
  competitors: CompetitorCreativeAnalysis[];
  messagingGaps: string[];
  differentiationOpportunities: string[];
  creativeRecommendations: string[];
  generatedAt: string;
}

const MAX_ANALYZED_COMPETITORS = 5;
const MEMORY_KIND = "creative-analysis";

const CREATIVE_ANALYSIS_TOOL = {
  name: "emit_creative_analysis",
  description: "Return an analysis of one competitor's marketing creative and messaging.",
  input_schema: {
    type: "object" as const,
    properties: {
      messaging: { type: "string", description: "Core marketing message / tagline themes" },
      ctas: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5, description: "Calls to action they commonly use" },
      tone: { type: "string", description: "Voice/tone of their marketing (e.g. playful, authoritative, technical)" },
      hooks: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5, description: "Attention-grabbing angles/hooks used in their ads or landing pages" },
      offers: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5, description: "Promotions, free trials, discounts, guarantees they advertise" },
      positioning: { type: "string" },
      visualThemes: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 5, description: "Visual/brand themes mentioned in available sources (colors, imagery style, design language) — best-effort, often unavailable" },
    },
    required: ["messaging", "ctas", "tone", "hooks", "offers", "positioning", "visualThemes"],
  },
};

const SYNTHESIS_TOOL = {
  name: "emit_creative_synthesis",
  description: "Compare competitors' creative approaches and recommend how this business should differentiate.",
  input_schema: {
    type: "object" as const,
    properties: {
      messagingGaps: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Messages/angles no competitor is using that this business could own" },
      differentiationOpportunities: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      creativeRecommendations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Concrete creative directions (headlines, hooks, offers) this business should try" },
    },
    required: ["messagingGaps", "differentiationOpportunities", "creativeRecommendations"],
  },
};

type AnalysisFields = Omit<CompetitorCreativeAnalysis, "name" | "citations" | "confidence">;

function fallbackAnalysis(name: string): AnalysisFields {
  return {
    messaging: `Unknown — no live research performed for ${name}.`,
    ctas: ["Not yet researched"],
    tone: "Unknown",
    hooks: ["Not yet researched"],
    offers: [],
    positioning: "Unknown",
    visualThemes: [],
  };
}

function computeConfidence(usedFallback: boolean, citationCount: number): number {
  if (usedFallback) return 0.1;
  return citationCount === 0 ? 0.35 : Math.round(Math.min(0.55 + citationCount * 0.08, 0.9) * 100) / 100;
}

async function analyzeCompetitorCreative(competitor: { name: string; url?: string }, industry: string | undefined): Promise<CompetitorCreativeAnalysis> {
  if (!llm) {
    return { name: competitor.name, ...fallbackAnalysis(competitor.name), citations: [], confidence: computeConfidence(true, 0) };
  }

  const research = await runWebSearch(
    `Analyze the marketing and advertising creative of "${competitor.name}"${industry ? ` in ${industry}` : ""}: their core messaging, calls to action, tone of voice, attention-grabbing hooks, offers/promotions, positioning, and any described visual/brand themes.`
  );

  const structured = research.narrative
    ? await runStructured<AnalysisFields>({
        maxTokens: 768,
        tool: CREATIVE_ANALYSIS_TOOL,
        messages: [{ role: "user", content: `Using this research, analyze "${competitor.name}"'s marketing creative.\n\nResearch findings:\n${research.narrative}` }],
      })
    : null;

  const usedFallback = !structured;
  const fields = structured ?? fallbackAnalysis(competitor.name);
  const citations = usedFallback ? [] : research.citations;

  return { name: competitor.name, ...fields, citations, confidence: computeConfidence(usedFallback, citations.length) };
}

async function writeCreativeMemory(analysis: CompetitorCreativeAnalysis, input: CreativeIntelligenceInput): Promise<void> {
  try {
    await writeMemory({
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      kind: MEMORY_KIND,
      sourceUrl: input.url,
      dedupKey: analysis.name.trim().toLowerCase(),
      content: `${analysis.name}: ${analysis.messaging} Tone: ${analysis.tone}. Hooks: ${analysis.hooks.join("; ")}.`,
      metadata: analysis as unknown as Record<string, unknown>,
    });
  } catch {
    // Research Memory is an enhancement, never a reason to fail the report.
  }
}

/**
 * Analyzes each supplied competitor's marketing creative (capped at 5 for cost), then
 * makes one synthesis pass comparing them all to surface messaging gaps, differentiation
 * opportunities, and concrete creative recommendations. Persists each competitor's
 * creative analysis to Research Memory via the Memory Coordinator (kind:
 * "creative-analysis") so later runs — for this business or others analyzing the same
 * competitor — reuse rather than re-research from scratch.
 */
export async function runCreativeIntelligence(input: CreativeIntelligenceInput): Promise<CreativeIntelligenceReport> {
  const toAnalyze = input.competitors.slice(0, MAX_ANALYZED_COMPETITORS);
  const analyses = await Promise.all(toAnalyze.map((c) => analyzeCompetitorCreative(c, input.industry)));

  await Promise.all(analyses.map((a) => (a.citations.length > 0 ? writeCreativeMemory(a, input) : Promise.resolve())));

  if (!llm || analyses.every((a) => a.citations.length === 0)) {
    return {
      businessUrl: input.url,
      competitors: analyses,
      messagingGaps: ["Not yet researched"],
      differentiationOpportunities: ["Not yet researched"],
      creativeRecommendations: ["Not yet researched"],
      generatedAt: new Date().toISOString(),
    };
  }

  const synthesis = await runStructured<Omit<CreativeIntelligenceReport, "businessUrl" | "competitors" | "generatedAt">>({
    maxTokens: 1024,
    tool: SYNTHESIS_TOOL,
    messages: [
      {
        role: "user",
        content: `Compare these competitors' creative approaches for "${input.businessName ?? hostnameOf(input.url)}" (${input.industry ?? "its category"}) and recommend how it should differentiate:\n\n${analyses
          .map((a) => `${a.name}: messaging="${a.messaging}", tone="${a.tone}", hooks=${JSON.stringify(a.hooks)}, offers=${JSON.stringify(a.offers)}, positioning="${a.positioning}"`)
          .join("\n")}`,
      },
    ],
  });

  return {
    businessUrl: input.url,
    competitors: analyses,
    messagingGaps: synthesis?.messagingGaps ?? ["Not yet researched"],
    differentiationOpportunities: synthesis?.differentiationOpportunities ?? ["Not yet researched"],
    creativeRecommendations: synthesis?.creativeRecommendations ?? ["Not yet researched"],
    generatedAt: new Date().toISOString(),
  };
}
