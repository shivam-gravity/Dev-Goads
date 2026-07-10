import { logger } from "../../modules/logger/logger.js";
import type { ProviderResult, ResearchContext } from "../types/index.js";
import { fuseKnowledge } from "./KnowledgeFusionEngine.js";
import {
  audienceSchema,
  companySchema,
  competitorSchema,
  generalSearchSchema,
  marketSchema,
  newsSchema,
  seoSchema,
  technologySchema,
  websiteSchema,
} from "./schemas.js";

export interface AggregateInput {
  jobId: string;
  workspaceId: string;
  businessId?: string;
  url: string;
  results: ProviderResult<unknown>[];
}

/** Validates one provider's raw data against its schema — returns null (and logs) on any
 * mismatch so a malformed provider payload degrades to "missing" rather than polluting
 * the strongly-typed ResearchContext with data that doesn't match its declared shape. */
function validate<T>(provider: string, schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: unknown } }, result: ProviderResult<unknown> | undefined): T | null {
  if (!result || result.status === "failed" || result.data === null) return null;
  const parsed = schema.safeParse(result.data);
  if (!parsed.success) {
    logger.warn(`KnowledgeAggregator: ${provider} returned data that failed schema validation — treating as missing`, parsed.error);
    return null;
  }
  return parsed.data as T;
}

/**
 * Merges the 9 providers' independent ProviderResult objects into one strongly-typed
 * ResearchContext — the "Knowledge Aggregator" stage between the parallel provider fan-out
 * and the downstream AI Agents step (createStrategyFromResearch, via toStrategyInput.ts).
 * Never throws: a missing/invalid provider becomes a null field plus a metadata entry,
 * so a partial research run still returns a usable (if incomplete) context rather than
 * failing the whole job over one bad provider.
 */
export function aggregateResearch(input: AggregateInput): ResearchContext {
  const byName = new Map(input.results.map((r) => [r.provider, r]));

  const providersSucceeded: string[] = [];
  const providersPartial: string[] = [];
  const providersFailed: string[] = [];
  for (const result of input.results) {
    if (result.status === "success") providersSucceeded.push(result.provider);
    else if (result.status === "partial") providersPartial.push(result.provider);
    else providersFailed.push(result.provider);
  }

  const confidenceByProvider: Record<string, number> = {};
  for (const result of input.results) confidenceByProvider[result.provider] = result.confidence;
  const overallConfidence = input.results.length > 0
    ? Math.round((input.results.reduce((sum, r) => sum + r.confidence, 0) / input.results.length) * 100) / 100
    : 0;

  const website = validate("website", websiteSchema, byName.get("website"));
  const company = validate("company", companySchema, byName.get("company"));
  const market = validate("market", marketSchema, byName.get("market"));
  const competitors = validate("competitor", competitorSchema, byName.get("competitor"));
  const audience = validate("audience", audienceSchema, byName.get("audience"));
  const technology = validate("technology", technologySchema, byName.get("technology"));
  const keywords = validate("seo", seoSchema, byName.get("seo"));
  const news = validate("news", newsSchema, byName.get("news"));
  const generalSearch = validate("search", generalSearchSchema, byName.get("search")) ?? undefined;

  const timestamps = input.results.flatMap((r) => [new Date(r.startedAt).getTime(), new Date(r.completedAt).getTime()]);
  const totalDurationMs = timestamps.length > 0 ? Math.max(...timestamps) - Math.min(...timestamps) : 0;

  return {
    jobId: input.jobId,
    workspaceId: input.workspaceId,
    businessId: input.businessId,
    url: input.url,
    website,
    market,
    technology,
    competitors,
    keywords,
    audience,
    company,
    news,
    metadata: {
      jobId: input.jobId,
      generatedAt: new Date().toISOString(),
      totalDurationMs,
      providersSucceeded,
      providersPartial,
      providersFailed,
      generalSearch,
      confidenceByProvider,
      overallConfidence,
      fusion: fuseKnowledge(input.results),
    },
  };
}
