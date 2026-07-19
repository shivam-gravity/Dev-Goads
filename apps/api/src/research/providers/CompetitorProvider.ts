import { llm } from "../../infra/llmClient.js";
import { logger } from "../../modules/logger/logger.js";
import { readMemory, writeMemory } from "../memory/MemoryCoordinator.js";
import type { ResearchProvider } from "../interfaces/ResearchProvider.js";
import type { CompetitorData, ProviderResult, ResearchProviderInput } from "../types/index.js";
import { citationsToEvidence, hostnameOf, runProviderStep, webSearchThenStructure } from "./support.js";

// Similarity floor for treating a Research Memory match as real signal worth injecting
// into the prompt. Calibrated empirically, not guessed: a live verification run against
// two genuine, same-niche competitors (Stripe and Adyen, both "payments processing")
// scored 0.52 on text-embedding-3-small — general-purpose text embeddings for short
// business-description strings cluster lower than intuition suggests even for a textbook
// match, since the model isn't fine-tuned for this task. 0.75 would have silently
// excluded that exact match. Revisit this number if real usage shows too much noise.
const MEMORY_MIN_SCORE = 0.45;
const MEMORY_TOP_K = 3;
const MEMORY_KIND = "competitor";

function memoryQueryText(input: ResearchProviderInput, industry: string): string {
  return `${input.businessName ?? hostnameOf(input.url)} — ${industry}`;
}

/** One Research Memory entry per RESEARCHED BUSINESS (dedupKey = businessId, falling back
 * to url) — re-running this provider for the same business updates that one entry rather
 * than piling up a new row every time, via MemoryCoordinator's dedup policy. The embedded
 * text and the stored candidates are both "business + industry" shaped (see
 * memoryQueryText), so a later job's query embedding lands in the same semantic
 * neighborhood as what's stored, rather than comparing apples (a business summary) to
 * oranges (a raw competitor name). Failures are logged, not thrown — Research Memory is
 * an enhancement, never a reason for the provider itself to fail. */
async function writeCompetitorMemory(input: ResearchProviderInput, industry: string, data: CompetitorData): Promise<void> {
  try {
    const content = `Business: ${input.businessName ?? input.url} (${industry}). Competitors found: ${data.competitors.map((c) => c.name).join(", ")}. Competition intensity: ${data.competitionIntensity}. Differentiators: ${data.differentiators.join("; ")}.`;
    await writeMemory({
      workspaceId: input.workspaceId,
      businessId: input.businessId,
      kind: MEMORY_KIND,
      sourceUrl: input.url,
      dedupKey: input.businessId ?? input.url,
      content,
      metadata: { industry, competitors: data.competitors, competitionIntensity: data.competitionIntensity, differentiators: data.differentiators },
    });
  } catch (err) {
    logger.warn("CompetitorProvider: failed to write Research Memory", err);
  }
}

/** Retrieves similar past competitor-research (other businesses, same rough industry
 * niche) to fold into the search/structure prompts — the actual "RAG" step: augmenting
 * this job's generation with retrieved context from Research Memory rather than starting
 * every job from a blank live search. Returns "" (a no-op prompt addition) on any failure
 * or when nothing sufficiently similar exists yet, same fail-soft posture as the write side. */
async function retrieveCompetitorMemoryContext(input: ResearchProviderInput, industry: string): Promise<string> {
  try {
    const matches = await readMemory({
      kind: MEMORY_KIND,
      queryText: memoryQueryText(input, industry),
      topK: MEMORY_TOP_K,
      minScore: MEMORY_MIN_SCORE,
      workspaceId: input.workspaceId,
      excludeBusinessId: input.businessId,
    });
    if (matches.length === 0) return "";
    return `\n\nPrior research found on OTHER businesses, retrieved by loose text similarity (Research Memory — this may be about a completely different industry that just happens to use similar vocabulary; only reuse a finding below if it is genuinely about the same product category as this business, otherwise ignore it entirely — do not blend it in):\n${matches.map((m) => `- ${m.content}`).join("\n")}`;
  } catch (err) {
    logger.warn("CompetitorProvider: failed to query Research Memory", err);
    return "";
  }
}

const COMPETITOR_TOOL = {
  name: "emit_competitor_analysis",
  description: "Return a structured competitor landscape.",
  input_schema: {
    type: "object" as const,
    properties: {
      competitors: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: { name: { type: "string" }, url: { type: "string" }, notes: { type: "string" } },
          required: ["name"],
        },
      },
      competitionIntensity: { type: "string" },
      differentiators: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
    },
    required: ["competitors", "competitionIntensity", "differentiators"],
  },
};

/** Named competitor landscape — independent of every other provider; identifies rivals
 * via live search on the target URL/industry alone. */
export class CompetitorProvider implements ResearchProvider<CompetitorData> {
  readonly name = "competitor";
  readonly priority = 50;

  async execute(input: ResearchProviderInput): Promise<ProviderResult<CompetitorData>> {
    return runProviderStep(this.name, 1, input, async () => {
      const industry = input.industry ?? "its category";
      // Research Memory only has anything to offer when there's a model to embed with —
      // without OPENAI_API_KEY this is a no-op string, same fail-soft posture as the rest
      // of this provider when there's no live search either.
      const memoryContext = llm ? await retrieveCompetitorMemoryContext(input, industry) : "";

      const { status, data, citations } = await webSearchThenStructure<CompetitorData>({
        maxTokens: 1024,
        tool: COMPETITOR_TOOL,
        // A fabricated url shouldn't cost us an otherwise-legitimate competitor name/notes —
        // unlike a Reddit thread (which IS its URL), a competitor's identity stands on its own.
        unverifiedUrlPolicy: "null-field",
        websiteExcerpt: input.websiteExcerpt,
        searchPrompt: `Research the main named competitors of the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""} in ${industry}. Find real competitor names and, where possible, their URLs and what differentiates them.${memoryContext}`,
        structurePrompt: (narrative) => `List named competitors and how this business could differentiate. Use the authoritative website content above to understand what this business actually sells, then identify companies that sell a DIRECTLY competing product in the same category. Do NOT list IT-services firms, consultancies, systems integrators, or agencies just because their own marketing happens to mention the same keyword/industry phrase (e.g. a literal search for "${industry}" can surface consulting firms with that phrase in their name — those are not real product competitors).\n\nWeb research findings:\n${narrative}\n\nBusiness URL: ${input.url}`,
        fallback: () => ({
          competitors: [{ name: "Other providers in this category" }],
          competitionIntensity: "Unknown — no live research performed",
          differentiators: ["Distinct offering worth exploring further"],
          dataSource: "",
        }),
      });

      // Only feed real, non-fallback results back into memory — writing the generic
      // placeholder ("Other providers in this category") would pollute future retrieval
      // with content that never actually said anything about a real business.
      if (citations.length > 0) {
        await writeCompetitorMemory(input, industry, data);
      }

      return { status, data, citations, evidence: citationsToEvidence(citations) };
    });
  }
}
