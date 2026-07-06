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
  activateVariant(externalId: string): Promise<void>;
  setBudget(input: SetBudgetInput): Promise<void>;
  fetchInsights(externalId: string, date: string): Promise<Omit<PerformanceMetric, "id" | "campaignId" | "variantId" | "network" | "date">>;
}

/**
 * Credentials for a workspace's connected Meta ad account (see integrationService.getMetaCredentials).
 * Optional on every hierarchy method below: when omitted, metaAdapter falls back to the
 * global META_ACCESS_TOKEN/META_AD_ACCOUNT_ID env vars, then to mock IDs if neither is set —
 * same three-tier fallback the rest of the adapters already use.
 */
export interface MetaCredentials {
  accessToken: string;
  adAccountId: string;
  pageId?: string;
  /** Ad account's billing currency — Meta's minor-unit conversion varies by currency (see metaAdapter's divisor table). */
  currency: string;
}

export interface CampaignContainerInput {
  name: string;
  /** Meta: campaign objective enum (e.g. OUTCOME_TRAFFIC). Google: ignored, channel type is fixed. */
  objective: string;
  /** Google only: budget is campaign-level there (shared across ad groups), unlike Meta's ad-set budgets. */
  dailyBudgetCents?: number;
  /** Google only: campaign-level geo/language criteria (from the first audience group — see googleTargetingMapper). */
  targeting?: Record<string, unknown>;
}

export interface AdSetContainerInput {
  campaignExternalId: string;
  name: string;
  /** Meta: this ad set's daily budget. Google: informational only — budget already set on the campaign. */
  dailyBudgetCents: number;
  targeting: Record<string, unknown>;
}

export interface CreativeUploadInput {
  imageUrl?: string;
  videoUrl?: string;
}

export interface CreativeUploadResult {
  imageHash?: string;
  videoId?: string;
}

export interface HierarchyAdInput {
  adSetExternalId: string;
  name: string;
  creative: AdCreative;
  landingPageUrl: string;
  imageHash?: string;
  videoId?: string;
}

/**
 * Optional real object-graph path (Campaign -> Ad Set/Ad Group -> Creative -> Ad) for
 * networks that support it. metaAdapter and googleAdapter implement this; tiktok stays on
 * the flat launchVariant path above until it gets the same depth in a follow-up.
 * Credentials are typed `unknown` here (each concrete adapter narrows to its own shape —
 * MetaCredentials vs GoogleAdsCredentials — since method-shorthand params are checked
 * bivariantly, this is a safe way to share one interface across differently-shaped adapters).
 */
export interface HierarchyCapableAdapter {
  createCampaignContainer?(input: CampaignContainerInput, credentials?: unknown): Promise<{ externalId: string }>;
  createAdSetContainer?(input: AdSetContainerInput, credentials?: unknown): Promise<{ externalId: string }>;
  uploadCreativeAsset?(input: CreativeUploadInput, credentials?: unknown): Promise<CreativeUploadResult>;
  createHierarchyAd?(input: HierarchyAdInput, credentials?: unknown): Promise<LaunchVariantResult>;
}
