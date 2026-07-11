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
