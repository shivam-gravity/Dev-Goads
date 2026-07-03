export type AdNetwork = "meta" | "google";

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
