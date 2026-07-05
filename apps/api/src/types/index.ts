export type AdNetwork = "meta" | "google";

export interface ScrapedSite {
  url: string;
  title: string;
  description: string;
  excerpt: string;
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
}

export interface AdStrategy {
  id: string;
  businessId: string;
  summary: string;
  recommendedNetworks: AdNetwork[];
  budgetSplit: Record<AdNetwork, number>;
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
