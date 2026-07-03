const BASE_URL = "/api";

let token: string | null = null;

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  if (!token) {
    const res = await fetch(`${BASE_URL}/auth/demo-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: "demo-user" }),
    });
    const data = await res.json();
    token = data.token;
  }

  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ? JSON.stringify(body.error) : `Request failed: ${res.status}`);
  }
  return res.json();
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
  recommendedNetworks: ("meta" | "google")[];
  budgetSplit: Record<string, number>;
  audiences: string[];
  creatives: AdCreative[];
  createdAt: string;
}

export interface CampaignVariant {
  id: string;
  creative: AdCreative;
  network: "meta" | "google";
  externalId?: string;
  status: string;
}

export interface Campaign {
  id: string;
  businessId: string;
  strategyId: string;
  name: string;
  status: string;
  networks: ("meta" | "google")[];
  dailyBudgetCents: number;
  variants: CampaignVariant[];
  createdAt: string;
  updatedAt: string;
}

export interface NormalizedPerformance {
  campaignId: string;
  variantId: string;
  network: "meta" | "google";
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
  action: string;
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

export const api = {
  createBusiness: (input: Omit<BusinessProfile, "id">) =>
    request<BusinessProfile>("/businesses", { method: "POST", body: JSON.stringify(input) }),
  getBusiness: (id: string) => request<BusinessProfile>(`/businesses/${id}`),
  generateStrategy: (businessId: string) =>
    request<AdStrategy>(`/businesses/${businessId}/strategies`, { method: "POST" }),
  listStrategies: (businessId: string) => request<AdStrategy[]>(`/businesses/${businessId}/strategies`),
  createCampaign: (input: { strategyId: string; name: string; dailyBudgetCents: number }) =>
    request<Campaign>("/campaigns", { method: "POST", body: JSON.stringify(input) }),
  listCampaigns: (businessId: string) => request<Campaign[]>(`/businesses/${businessId}/campaigns`),
  getCampaign: (id: string) => request<Campaign>(`/campaigns/${id}`),
  launchCampaign: (id: string) => request<Campaign>(`/campaigns/${id}/launch`, { method: "POST" }),
  ingestMetrics: (id: string) => request<unknown[]>(`/campaigns/${id}/ingest`, { method: "POST" }),
  getPerformance: (id: string) => request<NormalizedPerformance[]>(`/campaigns/${id}/performance`),
  optimize: (id: string) => request<OptimizationDecision[]>(`/campaigns/${id}/optimize`, { method: "POST" }),
  generateInvoice: (businessId: string, periodStart: string, periodEnd: string) =>
    request<Invoice>(`/businesses/${businessId}/invoices`, {
      method: "POST",
      body: JSON.stringify({ periodStart, periodEnd }),
    }),
  listInvoices: (businessId: string) => request<Invoice[]>(`/businesses/${businessId}/invoices`),
};
