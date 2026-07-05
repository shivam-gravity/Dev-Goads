export type AdNetwork = "meta" | "google" | "tiktok";

export interface ScrapedSite {
  url: string;
  title: string;
  description: string;
  excerpt: string;
  images: string[];
  crawledPages: string[];
}

export interface ProductAnalysis {
  productName: string;
  category: string;
  summary: string;
  valueProposition: string;
  keyFeatures: string[];
}

export interface AudienceSegment {
  name: string;
  description: string;
}

export interface AudienceAnalysis {
  primaryAudience: string;
  segments: AudienceSegment[];
  painPoints: string[];
  buyingMotivations: string[];
}

export type ProductCatalogSource = "shopify" | "facebook" | "google" | "woocommerce";

export interface ProductCatalogItem {
  id: string;
  source: ProductCatalogSource;
  name: string;
  category: string;
  priceCents: number;
  imageUrl: string;
  url: string;
}

export interface BusinessProfile {
  id: string;
  name: string;
  website?: string;
  industry: string;
  monthlyBudgetCents: number;
  goals: string[];
  targetAudience?: string;
}

export interface AdCreative {
  headline: string;
  body: string;
  callToAction: string;
  imageUrl?: string;
}

export interface AdStrategy {
  id: string;
  businessId: string;
  summary: string;
  recommendedNetworks: AdNetwork[];
  budgetSplit: Partial<Record<AdNetwork, number>>;
  audiences: string[];
  creatives: AdCreative[];
  createdAt: string;
}

export type CampaignStatus = "draft" | "launching" | "active" | "paused" | "completed" | "failed";

export interface CampaignVariant {
  id: string;
  creative: AdCreative;
  network: AdNetwork;
  externalId?: string;
  status: CampaignStatus;
  audienceName?: string;
  landingPageUrl?: string;
}

export interface Campaign {
  id: string;
  businessId: string;
  strategyId: string;
  name: string;
  status: CampaignStatus;
  networks: AdNetwork[];
  dailyBudgetCents: number;
  variants: CampaignVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface PerformanceMetric {
  id: string;
  campaignId: string;
  variantId: string;
  network: AdNetwork;
  date: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spendCents: number;
}

export interface NormalizedPerformance {
  campaignId: string;
  variantId: string;
  network: AdNetwork;
  impressions: number;
  clicks: number;
  conversions: number;
  spendCents: number;
  ctr: number;
  cpaCents: number | null;
  conversionRate: number;
}

export interface OptimizationDecision {
  campaignId: string;
  chosenVariantId: string;
  action: "increase_budget" | "decrease_budget" | "pause" | "hold";
  reason: string;
  decidedAt: string;
}

export interface Invoice {
  id: string;
  businessId: string;
  periodStart: string;
  periodEnd: string;
  adSpendCents: number;
  platformFeeCents: number;
  totalCents: number;
  createdAt: string;
}

export interface CreativeAsset {
  id: string;
  businessId: string;
  headline: string;
  body: string;
  callToAction: string;
  format: "text" | "image" | "video";
  tags: string[];
  createdAt: string;
}

export interface TrendPoint {
  date: string;
  impressions: number;
  clicks: number;
  conversions: number;
  spendCents: number;
  ctr: number;
}

export interface AnalyticsSummary {
  businessId: string;
  totalSpendCents: number;
  totalImpressions: number;
  totalClicks: number;
  totalConversions: number;
  avgCtr: number;
  avgCpc: number | null;
  roas: number | null;
  activeCampaigns: number;
  period: "all" | "month" | "week";
}

export interface AudienceSuggestion {
  name: string;
  description: string;
  estimatedReach: string;
  platforms: AdNetwork[];
  interests: string[];
  demographics: string;
  painPoints: string[];
  buyingIntent: "low" | "medium" | "high";
}

/* Ad Insights */

export type AdInsightNetwork = AdNetwork | "tiktok" | "bing";

export interface DistributionSlice {
  label: string;
  sharePct: number;
}

export interface AudienceInsightItem {
  name: string;
  tags: string[];
  cpaCents: number | null;
  spendCents: number;
  campaignCount: number;
}

export interface PageInsightItem {
  url: string;
  cvr: number;
  spendCents: number;
  campaignCount: number;
}

export interface CreativeInsightItem {
  id: string;
  headline: string;
  body: string;
  imageUrl?: string;
  ctr: number;
  cpaCents: number | null;
  campaignCount: number;
}

export interface AdInsightsResponse {
  network: AdInsightNetwork;
  isDemo: boolean;
  audience: {
    distribution: DistributionSlice[];
    top: AudienceInsightItem[];
  };
  pages: {
    distribution: DistributionSlice[];
    top: PageInsightItem[];
  };
  creative: {
    scatter: { id: string; ctr: number; cpaCents: number }[];
    topAds: CreativeInsightItem[];
  };
}
