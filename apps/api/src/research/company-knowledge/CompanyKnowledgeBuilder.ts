import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";
import { getBusiness } from "../../modules/business/businessService.js";
import { loadVerifiedFacts, type VerifiedFact } from "../../agents/crawlFacts.js";
import { logger } from "../../modules/logger/logger.js";
import type { ResearchContext } from "../types/index.js";

/**
 * The Company Knowledge Builder — assembles the persisted CompanyProfile from data the
 * research pipeline has ALREADY computed (ResearchContext + CrawlFact rows + the
 * user-entered Business record). Deliberately makes no new external calls (no web search,
 * no LLM extraction): this is pure synthesis of already-researched signals, not a new
 * research dimension. Upserted by businessId so a business always has exactly one current
 * profile — ResearchJob already keeps the raw research history this is assembled from, so
 * a separate version-history table here would just duplicate it.
 */

export interface CompanyProfileFaq {
  question: string;
  answer: string;
}

export interface CompanyProfilePersona {
  name: string;
  description: string;
}

export interface CompanyProfileData {
  overview: string;
  products: string[];
  services: string[];
  features: string[];
  pricing: string;
  industries: string[];
  targetAudience: string;
  icp: { summary: string; segments: { name: string; description: string }[] };
  personas: CompanyProfilePersona[];
  technology: string[];
  positioning: string;
  messaging: string[];
  socialProof: string[];
  faqs: CompanyProfileFaq[];
}

// CrawlFact's `field` is a free-form dot-path (e.g. "pricing.startingPrice", "guarantee") —
// there's no dedicated FAQ-extraction pass, so FAQs here are a documented heuristic derived
// from facts whose field reads like something a real FAQ page would answer, not a genuine
// Q&A crawl. Good enough as a starting point; a dedicated FAQ-page parse would replace this.
const FAQ_FACT_KEYWORDS = /guarantee|refund|shipping|support|return|warranty|faq|cancellation/i;

function faqsFromFacts(facts: VerifiedFact[]): CompanyProfileFaq[] {
  return facts
    .filter((f) => FAQ_FACT_KEYWORDS.test(f.field))
    .slice(0, 8)
    .map((f) => ({ question: `What is the policy on ${f.field.split(".").pop()}?`, answer: f.value }));
}

// ProductEntry has no explicit product-vs-service flag — priceText/availability are the
// closest signal a crawled product listing has (a service is more often quoted/custom than
// carrying a fixed priceText), so that's the heuristic used to split the two below.
function buildProducts(context: ResearchContext): { products: string[]; services: string[]; features: string[]; pricing: string } {
  const entries = context.product?.products ?? [];
  const products = entries.filter((p) => p.priceText || p.availability).map((p) => p.name);
  const services = entries.filter((p) => !p.priceText && !p.availability).map((p) => p.name);
  const features = [...new Set(entries.flatMap((p) => p.features))];
  const priceTexts = entries.map((p) => p.priceText).filter((t): t is string => Boolean(t));

  const pricing = context.company?.pricingModel
    ? `${context.company.pricingModel}${priceTexts.length > 0 ? ` — ${priceTexts.slice(0, 3).join(", ")}` : ""}`
    : priceTexts.length > 0
    ? priceTexts.slice(0, 3).join(", ")
    : "Pricing not determined by current research";

  return { products, services, features, pricing };
}

function buildPersonas(context: ResearchContext): CompanyProfilePersona[] {
  return (context.audience?.segments ?? []).map((s) => ({ name: s.name, description: s.description }));
}

function buildPositioning(context: ResearchContext): string {
  const base = context.company?.summary ?? "";
  const differentiators = context.competitors?.differentiators ?? [];
  if (differentiators.length === 0) return base || "Not determined by current research";
  return `${base} Differentiated by: ${differentiators.join("; ")}`.trim();
}

function buildMessaging(context: ResearchContext): string[] {
  const pillars = context.contentMarketing?.contentPillars ?? [];
  const praise = context.reviews?.topPraise ?? [];
  return [...new Set([...pillars, ...praise])].slice(0, 10);
}

function buildSocialProof(context: ResearchContext): string[] {
  const proof: string[] = [];
  if (context.reviews?.averageRating) {
    proof.push(`${context.reviews.averageRating} average rating${context.reviews.totalReviewsEstimate ? ` (${context.reviews.totalReviewsEstimate})` : ""}`);
  }
  proof.push(...(context.reviews?.topPraise ?? []));
  for (const platform of context.socialMedia?.platforms ?? []) {
    if (platform.followers) proof.push(`${platform.followers} followers on ${platform.platform}`);
  }
  if (context.appStore?.ratingSummary) proof.push(`App store: ${context.appStore.ratingSummary}`);
  return [...new Set(proof)].slice(0, 10);
}

function buildTechnology(context: ResearchContext): string[] {
  const site = context.technology;
  const fromSite = [site?.cms, site?.ecommercePlatform, site?.hostingProvider, ...(site?.frameworks ?? []), ...(site?.analyticsTools ?? [])].filter(
    (v): v is string => Boolean(v)
  );
  const fromCompany = context.company?.technologyStack ?? [];
  return [...new Set([...fromCompany, ...fromSite])];
}

/** Pure assembly — no I/O, so it's directly unit-testable against a ResearchContext fixture
 * without a database. */
export function buildCompanyProfileData(
  context: ResearchContext,
  business: { industry?: string; targetAudience?: string } | null,
  facts: VerifiedFact[]
): CompanyProfileData {
  const { products, services, features, pricing } = buildProducts(context);

  return {
    overview: context.company?.summary ?? context.website?.description ?? `No company overview available for ${context.url}.`,
    products,
    services,
    features,
    pricing,
    industries: business?.industry ? [business.industry] : [],
    targetAudience: context.audience?.primaryAudience ?? business?.targetAudience ?? "Not determined by current research",
    icp: {
      summary: context.audience?.primaryAudience ?? "Not determined by current research",
      segments: context.audience?.segments ?? [],
    },
    personas: buildPersonas(context),
    technology: buildTechnology(context),
    positioning: buildPositioning(context),
    messaging: buildMessaging(context),
    socialProof: buildSocialProof(context),
    faqs: faqsFromFacts(facts),
  };
}

export interface CompanyProfileRecord {
  id: string;
  businessId: string;
  workspaceId: string;
  sourceResearchJobId: string | null;
  data: CompanyProfileData;
  generatedAt: Date;
}

/**
 * Builds and upserts the CompanyProfile for context.businessId. Best-effort, same
 * "enhancement, never a hard dependency" posture as the Decision Engine/Intelligence
 * Enrichment steps it runs alongside — a failure here never fails campaign generation.
 * Returns null when context has no businessId (nothing to key the upsert on) or on any
 * persistence failure.
 */
export async function buildAndPersistCompanyProfile(context: ResearchContext): Promise<CompanyProfileRecord | null> {
  if (!context.businessId) return null;

  try {
    const [business, facts] = await Promise.all([getBusiness(context.businessId).catch(() => null), loadVerifiedFacts(context)]);

    const data = buildCompanyProfileData(context, business, facts);
    const id = randomUUID();

    const row = await prisma.companyProfile.upsert({
      where: { businessId: context.businessId },
      create: { id, businessId: context.businessId, workspaceId: context.workspaceId, sourceResearchJobId: context.jobId, data: data as any, generatedAt: new Date() },
      update: { workspaceId: context.workspaceId, sourceResearchJobId: context.jobId, data: data as any, generatedAt: new Date() },
    });

    return {
      id: row.id,
      businessId: row.businessId,
      workspaceId: row.workspaceId,
      sourceResearchJobId: row.sourceResearchJobId,
      data,
      generatedAt: row.generatedAt,
    };
  } catch (err) {
    logger.warn(`Company Knowledge Builder failed for business ${context.businessId} — continuing without a persisted profile`, err);
    return null;
  }
}

export async function getCompanyProfile(businessId: string): Promise<CompanyProfileRecord | null> {
  const row = await prisma.companyProfile.findUnique({ where: { businessId } });
  if (!row) return null;
  return {
    id: row.id,
    businessId: row.businessId,
    workspaceId: row.workspaceId,
    sourceResearchJobId: row.sourceResearchJobId,
    data: row.data as unknown as CompanyProfileData,
    generatedAt: row.generatedAt,
  };
}
