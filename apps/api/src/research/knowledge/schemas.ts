import { z } from "zod";

/**
 * One zod schema per ResearchContext field — the Knowledge Aggregator's validation
 * layer. A provider's raw `data` is only trusted into the final ResearchContext once
 * it round-trips through the matching schema here; anything malformed (a provider bug,
 * an LLM returning a slightly-off shape) is dropped to null and counted as a failed
 * provider instead of silently poisoning the aggregated context.
 */

export const websiteSchema = z.object({
  title: z.string(),
  description: z.string(),
  excerpt: z.string(),
  images: z.array(z.string()),
  crawledPages: z.array(z.string()),
  pagesDiscovered: z.number(),
  screenshot: z.string().optional(),
  dataSource: z.string(),
  crawlJobId: z.string().optional(),
});

export const technologySchema = z.object({
  cms: z.string().optional(),
  ecommercePlatform: z.string().optional(),
  analyticsTools: z.array(z.string()),
  frameworks: z.array(z.string()),
  hostingProvider: z.string().optional(),
  detectedFrom: z.array(z.string()),
  dataSource: z.string(),
});

export const companySchema = z.object({
  name: z.string(),
  summary: z.string(),
  foundedYear: z.string().optional(),
  headquarters: z.string().optional(),
  employeeRange: z.string().optional(),
  fundingStage: z.string().optional(),
  dataSource: z.string(),
});

export const marketSchema = z.object({
  marketSize: z.string().optional(),
  growthRate: z.string().optional(),
  trends: z.array(z.string()),
  recommendedRegion: z.string().optional(),
  competitionLevel: z.string(),
  dataSource: z.string(),
});

export const competitorSchema = z.object({
  competitors: z.array(z.object({ name: z.string(), url: z.string().optional(), notes: z.string().optional() })),
  competitionIntensity: z.string(),
  differentiators: z.array(z.string()),
  dataSource: z.string(),
});

export const audienceSchema = z.object({
  primaryAudience: z.string(),
  segments: z.array(z.object({ name: z.string(), description: z.string() })),
  painPoints: z.array(z.string()),
  interestTags: z.array(z.string()),
  demographics: z.object({ ageDistribution: z.string(), genderRatio: z.string() }).optional(),
  dataSource: z.string(),
});

export const seoSchema = z.object({
  primaryKeywords: z.array(z.string()),
  metaTitle: z.string().optional(),
  metaDescription: z.string().optional(),
  headings: z.array(z.string()),
  dataSource: z.string(),
});

export const newsSchema = z.object({
  articles: z.array(z.object({ title: z.string(), url: z.string(), snippet: z.string().optional() })),
  summary: z.string(),
  dataSource: z.string(),
});

export const generalSearchSchema = z.object({
  narrative: z.string(),
  searchesUsed: z.number(),
  dataSource: z.string(),
});

export const socialMediaSchema = z.object({
  platforms: z.array(z.object({ platform: z.string(), handle: z.string().optional(), followers: z.string().optional(), engagementLevel: z.string().optional() })),
  overallPresence: z.string(),
  dataSource: z.string(),
});

export const reviewsSchema = z.object({
  averageRating: z.string().optional(),
  totalReviewsEstimate: z.string().optional(),
  topPraise: z.array(z.string()),
  topComplaints: z.array(z.string()),
  reviewSources: z.array(z.string()),
  dataSource: z.string(),
});

export const fundingSchema = z.object({
  totalRaised: z.string().optional(),
  latestRound: z.string().optional(),
  investors: z.array(z.string()),
  valuation: z.string().optional(),
  fundingTimeline: z.array(z.string()),
  dataSource: z.string(),
});

export const hiringSignalsSchema = z.object({
  openRolesEstimate: z.string().optional(),
  growthSignal: z.string(),
  keyDepartmentsHiring: z.array(z.string()),
  dataSource: z.string(),
});

export const contentMarketingSchema = z.object({
  hasActiveBlog: z.boolean(),
  publishingCadence: z.string().optional(),
  contentPillars: z.array(z.string()),
  contentGaps: z.array(z.string()),
  dataSource: z.string(),
});

export const backlinkAuthoritySchema = z.object({
  domainAuthorityEstimate: z.string().optional(),
  notableBacklinkSources: z.array(z.string()),
  seoStrengthSummary: z.string(),
  dataSource: z.string(),
});

export const appStoreSchema = z.object({
  hasApp: z.boolean(),
  platforms: z.array(z.string()),
  ratingSummary: z.string().optional(),
  categoryRanking: z.string().optional(),
  dataSource: z.string(),
});

export const videoPresenceSchema = z.object({
  hasYoutubeChannel: z.boolean(),
  subscriberEstimate: z.string().optional(),
  contentThemes: z.array(z.string()),
  engagementSummary: z.string(),
  dataSource: z.string(),
});

export const localPresenceSchema = z.object({
  hasLocalPresence: z.boolean(),
  googleBusinessRating: z.string().optional(),
  locationsEstimate: z.string().optional(),
  localSeoNotes: z.array(z.string()),
  dataSource: z.string(),
});

export const partnershipSchema = z.object({
  integrations: z.array(z.string()),
  partners: z.array(z.string()),
  ecosystemSummary: z.string(),
  dataSource: z.string(),
});

export const legalRegulatorySchema = z.object({
  applicableRegulations: z.array(z.string()),
  industrySpecificRisks: z.array(z.string()),
  complianceSummary: z.string(),
  dataSource: z.string(),
});
