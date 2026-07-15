import { llm, runStructured, runWebSearch } from "../../infra/llmClient.js";
import { hostnameOf } from "../providers/support.js";
import { readMemory } from "../memory/MemoryCoordinator.js";
import type { DiscoveredCompetitor } from "./types.js";

export interface DiscoveryInput {
  url: string;
  businessName?: string;
  industry?: string;
  workspaceId: string;
  businessId?: string;
}

const NAME_EXTRACTION_TOOL = {
  name: "emit_competitor_names",
  description: "Extract the real, named companies/products mentioned as competitors in this text.",
  input_schema: {
    type: "object" as const,
    properties: {
      competitors: {
        type: "array",
        minItems: 0,
        maxItems: 12,
        items: {
          type: "object",
          properties: { name: { type: "string" }, url: { type: "string" } },
          required: ["name"],
        },
      },
    },
    required: ["competitors"],
  },
};

async function extractNamesFromNarrative(narrative: string): Promise<{ name: string; url?: string }[]> {
  if (!narrative.trim()) return [];
  const result = await runStructured<{ competitors: { name: string; url?: string }[] }>({
    maxTokens: 512,
    tool: NAME_EXTRACTION_TOOL,
    messages: [{ role: "user", content: `Extract named competitors from this text:\n\n${narrative}` }],
  });
  return result?.competitors ?? [];
}

/** Source 1: a direct "who competes with X" search — the same angle CompetitorProvider
 * already uses, kept here too since it's still a legitimate, independent signal. */
async function discoverFromDirectSearch(input: DiscoveryInput): Promise<{ name: string; url?: string }[]> {
  if (!llm) return [];
  const research = await runWebSearch(
    `Who are the main direct competitors of the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""} in ${input.industry ?? "its category"}? List real, named companies.`
  );
  return extractNamesFromNarrative(research.narrative);
}

/** Source 2: an "alternatives"/comparison-angle search — deliberately different phrasing
 * from source 1, since "X alternatives" and "X vs" queries tend to surface review-site
 * roundups (G2, Capterra, ...) and comparison articles that a plain "competitors of X"
 * query often doesn't, giving a genuinely independent second read on the landscape. */
async function discoverFromAlternativesSearch(input: DiscoveryInput): Promise<{ name: string; url?: string }[]> {
  if (!llm) return [];
  const subject = input.businessName ?? hostnameOf(input.url);
  const research = await runWebSearch(
    `What are the best alternatives to ${subject} in ${input.industry ?? "its category"}? Include named products/companies from comparison articles, review sites, and "X vs Y" style content.`
  );
  return extractNamesFromNarrative(research.narrative);
}

/** Source 3: Research Memory — prior competitor research on similar businesses, already
 * embedded and stored by CompetitorProvider (kind: "competitor") or a previous Competitor
 * Intelligence Engine run (kind: "competitor-profile"). A genuinely independent source in
 * the sense that it costs no new web search and reflects what was ALREADY found for
 * comparable businesses, not a fresh read of the same live web content sources 1/2 hit. */
async function discoverFromResearchMemory(input: DiscoveryInput): Promise<{ name: string; url?: string }[]> {
  if (!llm) return [];
  const queryText = `${input.businessName ?? hostnameOf(input.url)} — ${input.industry ?? "its category"}`;

  const [fromCompetitorKind, fromProfileKind] = await Promise.all([
    readMemory({ kind: "competitor", queryText, workspaceId: input.workspaceId, topK: 3, excludeBusinessId: input.businessId }),
    readMemory({ kind: "competitor-profile", queryText, workspaceId: input.workspaceId, topK: 5, excludeBusinessId: input.businessId }),
  ]);

  const names: { name: string; url?: string }[] = [];
  for (const match of fromCompetitorKind) {
    const competitors = (match.metadata as { competitors?: { name: string; url?: string }[] }).competitors ?? [];
    names.push(...competitors.map((c) => ({ name: c.name, url: c.url })));
  }
  for (const match of fromProfileKind) {
    const name = (match.metadata as { name?: string }).name;
    if (name) names.push({ name, url: (match.metadata as { url?: string }).url });
  }
  return names;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export interface SourceResult {
  source: string;
  names: { name: string; url?: string }[];
}

/**
 * Pure merge/dedupe step, deliberately separated from the async source-calling above so
 * it's directly unit-testable with hand-built fixtures rather than needing to mock 3 live
 * API-backed functions. Case-insensitive name matching; a name several sources agree on
 * keeps every source that mentioned it (mentionedBy) and fills in a URL from whichever
 * source happened to provide one first.
 */
export function mergeDiscoveredCompetitors(results: SourceResult[]): { competitors: DiscoveredCompetitor[]; sourcesUsed: string[] } {
  const byNormalizedName = new Map<string, DiscoveredCompetitor>();
  const sourcesUsed: string[] = [];
  for (const { source, names } of results) {
    if (names.length > 0) sourcesUsed.push(source);
    for (const { name, url } of names) {
      const key = normalizeName(name);
      if (!key) continue;
      const existing = byNormalizedName.get(key);
      if (existing) {
        if (!existing.mentionedBy.includes(source)) existing.mentionedBy.push(source);
        if (!existing.url && url) existing.url = url;
      } else {
        byNormalizedName.set(key, { name, url, mentionedBy: [source] });
      }
    }
  }

  return { competitors: [...byNormalizedName.values()], sourcesUsed };
}

/**
 * Runs all 3 independent sources in parallel and merges the result into one deduplicated
 * candidate list, tracking which source(s) corroborate each name — this is the raw
 * material enrichment.ts then deep-dives on. Never throws: a source that returns nothing
 * (no OPENAI_API_KEY, no memory yet, a search that found nothing) just contributes zero
 * candidates rather than failing discovery for the other sources.
 */
export async function discoverCompetitors(input: DiscoveryInput): Promise<{ competitors: DiscoveredCompetitor[]; sourcesUsed: string[] }> {
  const sources: { name: string; run: () => Promise<{ name: string; url?: string }[]> }[] = [
    { name: "direct-search", run: () => discoverFromDirectSearch(input) },
    { name: "alternatives-search", run: () => discoverFromAlternativesSearch(input) },
    { name: "research-memory", run: () => discoverFromResearchMemory(input) },
  ];

  const results = await Promise.all(
    sources.map(async (source) => ({ source: source.name, names: await source.run().catch(() => [] as { name: string; url?: string }[]) }))
  );

  return mergeDiscoveredCompetitors(results);
}
