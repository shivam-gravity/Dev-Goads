import type { AdCreative, AdNetwork, CampaignVariant, PerformanceMetric } from "../../types/index.js";

export interface LaunchVariantInput {
  campaignId: string;
  variantId: string;
  creative: AdCreative;
  dailyBudgetCents: number;
  audience?: string;
}

export interface LaunchVariantResult {
  externalId: string;
  status: CampaignVariant["status"];
}

export interface SetBudgetInput {
  externalId: string;
  dailyBudgetCents: number;
}

export interface AdAdapter {
  readonly network: AdNetwork;
  launchVariant(input: LaunchVariantInput): Promise<LaunchVariantResult>;
  pauseVariant(externalId: string): Promise<void>;
  setBudget(input: SetBudgetInput): Promise<void>;
  fetchInsights(externalId: string, date: string): Promise<Omit<PerformanceMetric, "id" | "campaignId" | "variantId" | "network" | "date">>;
}
