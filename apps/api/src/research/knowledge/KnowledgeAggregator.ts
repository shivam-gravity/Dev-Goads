import { logger } from "../../modules/logger/logger.js";
import type { CompanyData, NewsData, ProviderResult, ResearchContext } from "../types/index.js";
import { fuseKnowledge } from "./KnowledgeFusionEngine.js";
import {
  appStoreSchema,
  audienceSchema,
  backlinkAuthoritySchema,
  companySchema,
  competitorSchema,
  contentMarketingSchema,
  fundingSchema,
  generalSearchSchema,
  hiringSignalsSchema,
  legalRegulatorySchema,
  localPresenceSchema,
  marketSchema,
  newsSchema,
  partnershipSchema,
  reviewsSchema,
  seoSchema,
  socialMediaSchema,
  technologySchema,
  videoPresenceSchema,
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

// Deliberately keyword-based, not an LLM call — this runs on every aggregation and only
// needs to catch the common, explicit ways funding news gets phrased. False negatives
// (a real funding article phrased unusually) just mean company.fundingStage stays as
// CompanyProvider left it; this never invents a funding stage that wasn't reported.
const FUNDING_KEYWORDS = /\b(raised|funding round|series [a-e]\b|seed round|valuation|venture capital|secures? \$|closes? \$)/i;

/**
 * CompanyProvider and NewsProvider run fully independently (see ResearchProvider's "no
 * inter-provider dependency" contract) and never see each other's output — so a company
 * profile can say `fundingStage: "unknown"` in the same research pass where NewsProvider
 * turned up an actual funding-round article, with nothing ever correlating the two. This
 * reconciles them here, once both are already-computed ProviderResults, the same way
 * KnowledgeFusionEngine.detectConflicts reconciles market vs. competitor intensity — a
 * post-hoc read of two already-independent results, not a new dependency between the
 * providers themselves. Only fires when CompanyProvider didn't already report a real
 * funding stage, so a genuine "Series C" from CompanyProvider is never overwritten by a
 * vaguer news mention.
 */
function reconcileCompanyFunding(company: CompanyData | null, news: NewsData | null): CompanyData | null {
  if (!company || !news) return company;
  const hasRealFundingStage = company.fundingStage && !/unknown/i.test(company.fundingStage);
  if (hasRealFundingStage) return company;

  const fundingArticle = news.articles.find((a) => FUNDING_KEYWORDS.test(a.title) || (a.snippet && FUNDING_KEYWORDS.test(a.snippet)));
  if (!fundingArticle) return company;

  const note = fundingArticle.snippet ?? fundingArticle.title;
  return { ...company, fundingStage: `Recent funding news (via NewsProvider): ${note}` };
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
  const news = validate("news", newsSchema, byName.get("news"));
  const company = reconcileCompanyFunding(validate("company", companySchema, byName.get("company")), news);
  const market = validate("market", marketSchema, byName.get("market"));
  const competitors = validate("competitor", competitorSchema, byName.get("competitor"));
  const audience = validate("audience", audienceSchema, byName.get("audience"));
  const technology = validate("technology", technologySchema, byName.get("technology"));
  const keywords = validate("seo", seoSchema, byName.get("seo"));
  const generalSearch = validate("search", generalSearchSchema, byName.get("search")) ?? undefined;
  const socialMedia = validate("social-media", socialMediaSchema, byName.get("social-media"));
  const reviews = validate("reviews", reviewsSchema, byName.get("reviews"));
  const funding = validate("funding", fundingSchema, byName.get("funding"));
  const hiringSignals = validate("hiring-signals", hiringSignalsSchema, byName.get("hiring-signals"));
  const contentMarketing = validate("content-marketing", contentMarketingSchema, byName.get("content-marketing"));
  const backlinkAuthority = validate("backlink-authority", backlinkAuthoritySchema, byName.get("backlink-authority"));
  const appStore = validate("app-store", appStoreSchema, byName.get("app-store"));
  const videoPresence = validate("video-presence", videoPresenceSchema, byName.get("video-presence"));
  const localPresence = validate("local-presence", localPresenceSchema, byName.get("local-presence"));
  const partnerships = validate("partnerships", partnershipSchema, byName.get("partnerships"));
  const legalRegulatory = validate("legal-regulatory", legalRegulatorySchema, byName.get("legal-regulatory"));

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
    socialMedia,
    reviews,
    funding,
    hiringSignals,
    contentMarketing,
    backlinkAuthority,
    appStore,
    videoPresence,
    localPresence,
    partnerships,
    legalRegulatory,
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
