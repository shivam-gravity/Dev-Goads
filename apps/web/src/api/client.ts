const BASE_URL = "/api";

// ── Token management ──────────────────────────────────────────────────────────
let _token: string | null = localStorage.getItem("adgo_token");

export function setToken(t: string | null) {
  _token = t;
  if (t) localStorage.setItem("adgo_token", t);
  else localStorage.removeItem("adgo_token");
}

export function getToken() { return _token; }

async function getOrFetchDemoToken(): Promise<string> {
  if (_token) return _token;
  const res = await fetch(`${BASE_URL}/auth/demo-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subject: "demo-user" }),
  });
  const data = await res.json();
  setToken(data.token);
  return data.token;
}

// Defense-in-depth: the backend should never send internals in an error message
// (see docs/architecture-roadmap.md and the 2026-07-06 QA report), but if it ever
// does — a misconfigured environment, a new endpoint that forgot the pattern —
// this stops a raw stack trace from ending up on someone's screen.
const LOOKS_INTERNAL = /prisma|stacktrace|\.(ts|js):\d+|at\s+\w+\s*\(/i;
const GENERIC_ERROR = "Something went wrong. Please try again.";

function firstFieldError(fieldErrors: Record<string, string[]>): string | null {
  const firstKey = Object.keys(fieldErrors)[0];
  return firstKey ? fieldErrors[firstKey][0] : null;
}

function extractErrorMessage(error: unknown): string {
  if (typeof error === "string") {
    return error.length > 300 || LOOKS_INTERNAL.test(error) ? GENERIC_ERROR : error;
  }
  if (error && typeof error === "object" && "fieldErrors" in error) {
    return firstFieldError((error as { fieldErrors: Record<string, string[]> }).fieldErrors) ?? GENERIC_ERROR;
  }
  return GENERIC_ERROR;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = _token ?? await getOrFetchDemoToken();

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
    throw new Error(body.error ? extractErrorMessage(body.error) : `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

// ── Types ─────────────────────────────────────────────────────────────────────
export interface User { id: string; email: string; name: string; avatar?: string; createdAt: string; }
export interface Workspace { id: string; name: string; ownerId: string; plan: "starter" | "pro" | "agency"; logoUrl?: string; timezone: string; createdAt: string; }
export interface WorkspaceMember { id: string; workspaceId: string; userId: string; role: "owner" | "admin" | "member" | "viewer"; invitedAt: string; joinedAt?: string; user?: { name: string; email: string; avatar?: string }; }
export interface AuthResult { user: User; token: string; workspaceId?: string; }
export interface BusinessProfile { id: string; name: string; website?: string; industry: string; monthlyBudgetCents: number; goals: string[]; targetAudience?: string; brandName?: string; logoUrls?: string[]; }
export interface AdCreative { headline: string; body: string; callToAction: string; }
export interface AdStrategy { id: string; businessId: string; summary: string; recommendedNetworks: ("meta" | "google")[]; budgetSplit: Record<string, number>; audiences: string[]; creatives: AdCreative[]; createdAt: string; }
export interface CampaignVariant { id: string; creative: AdCreative; network: "meta" | "google"; externalId?: string; status: string; }
export interface Campaign { id: string; businessId: string; strategyId: string; name: string; status: string; networks: ("meta" | "google")[]; dailyBudgetCents: number; variants: CampaignVariant[]; createdAt: string; updatedAt: string; }
export interface NormalizedPerformance { campaignId: string; variantId: string; network: "meta" | "google"; impressions: number; clicks: number; conversions: number; spendCents: number; ctr: number; cpaCents: number | null; conversionRate: number; }
export interface OptimizationDecision { campaignId: string; chosenVariantId: string; action: string; reason: string; decidedAt: string; }
export interface Invoice { id: string; businessId: string; periodStart: string; periodEnd: string; adSpendCents: number; platformFeeCents: number; totalCents: number; createdAt: string; }
export interface ScrapedSite { url: string; title: string; description: string; excerpt: string; images: string[]; crawledPages: string[]; screenshot?: string; }
export interface ProductAnalysis {
  productName: string; category: string; summary: string; valueProposition: string; keyFeatures: string[];
  businessType?: string; pricingModel?: string; pricingRange?: string; dataSource?: string;
}
export interface AudienceAnalysis {
  primaryAudience: string; segments: { name: string; description: string }[]; painPoints: string[]; buyingMotivations: string[];
  demographics?: { ageDistribution: string; genderRatio: string; occupation: string };
  consumerCharacteristics?: string; interestTags?: string[]; recommendedObjective?: string; recommendedPerformanceGoal?: string; dataSource?: string;
}
export interface DeepResearchResult { site: ScrapedSite; product: ProductAnalysis; audience: AudienceAnalysis; }

export interface Citation { url: string; title: string; }
export interface DeepResearchBlock<T = unknown> { key: string; label: string; citations: Citation[]; data: T; }
export interface CompetitorBudgetAnalysis { competitors: string[]; competitionIntensity: string; differentiators: string[]; budgetReasoning: string[]; recommendedDailyBudgetCents: number; dataSource: string; }
export interface MarketLocationAnalysis { recommendedRegion: string; alternativeRegions: string[]; marketTrends: string; competitionLevel: string; recommendedPlatform: "meta" | "google" | "tiktok"; placementRationale: string; dataSource: string; }
export interface AudiencePersona { name: string; ageRange: string; genderSplit: string; details: string; interests: string[]; }
export interface ResearchSessionResult { site: ScrapedSite; product: ProductAnalysis; audience: AudienceAnalysis; competitorBudget: CompetitorBudgetAnalysis; marketLocation: MarketLocationAnalysis; personas: AudiencePersona[]; }
export interface ResearchSession {
  id: string; workspaceId: string; businessId?: string; url: string;
  status: "queued" | "running" | "done" | "failed";
  currentStep?: string;
  blocks: DeepResearchBlock[];
  personas?: AudiencePersona[];
  result?: ResearchSessionResult;
  error?: string;
  searchCount: number;
  cacheHit: boolean;
  createdAt: string; updatedAt: string;
}
export interface CreativeAsset { id: string; businessId: string; headline: string; body: string; callToAction: string; format: "text" | "image" | "video"; tags: string[]; createdAt: string; }
export interface CreativeVariation { headline: string; body: string; callToAction: string; angle: string; }
export interface TrendPoint { date: string; impressions: number; clicks: number; conversions: number; spendCents: number; ctr: number; }
export interface AnalyticsSummary { businessId: string; totalSpendCents: number; totalImpressions: number; totalClicks: number; totalConversions: number; avgCtr: number; avgCpc: number | null; roas: number | null; activeCampaigns: number; period: "all" | "month" | "week"; }
export interface AudienceSuggestion { name: string; description: string; estimatedReach: string; platforms: ("meta" | "google")[]; interests: string[]; demographics: string; painPoints: string[]; buyingIntent: "low" | "medium" | "high"; }
export interface StrategistChatMessage { role: "user" | "assistant"; content: string; }

export interface Notification { id: string; workspaceId: string; type: string; title: string; message: string; read: boolean; severity: "info" | "warning" | "success" | "error"; actionUrl?: string; createdAt: string; }
export interface Asset { id: string; workspaceId: string; name: string; type: "image" | "video" | "logo" | "font" | "template"; url: string; thumbnailUrl?: string; size: number; mimeType: string; tags: string[]; usageCount: number; width?: number; height?: number; createdAt: string; }
export interface Insight { id: string; workspaceId: string; type: "anomaly" | "recommendation" | "trend" | "opportunity"; title: string; description: string; metric?: string; change?: number; severity: "low" | "medium" | "high"; actionLabel?: string; actionUrl?: string; dismissed: boolean; createdAt: string; }
export interface Integration { id: string; workspaceId: string; platform: "meta" | "google" | "tiktok" | "shopify" | "pixel"; status: "connected" | "disconnected" | "error" | "pending"; accountName?: string; accountId?: string; permissions: string[]; settings: Record<string, unknown>; connectedAt?: string; errorMessage?: string; updatedAt: string; }
export interface SavedAudience { id: string; workspaceId: string; name: string; ageMin: number; ageMax: number; gender: "all" | "male" | "female"; locations: string[]; interests: string[]; exclusions: string[]; estimatedReach?: string; createdAt: string; }
export interface ReachEstimate { usersLowerBound: number; usersUpperBound: number; source: "meta" | "heuristic"; }
export interface GenerationJobInput { businessId: string; productUrl?: string; prompt?: string; wantVideo: boolean; }
export interface GenerationJobResult { headline: string; body: string; callToAction: string; creativeId: string; imageAssetId: string; imageUrl: string; videoAssetId?: string; videoUrl?: string; }
export interface GenerationJob { id: string; workspaceId: string; businessId: string; type: "image" | "video" | "full_creative"; status: "queued" | "running" | "done" | "failed"; input: GenerationJobInput; result?: GenerationJobResult; error?: string; createdAt: string; updatedAt: string; }
export type ProductCatalogSource = "shopify" | "facebook" | "google";
export interface ProductCatalogItem { id: string; source: ProductCatalogSource; name: string; category: string; priceCents: number; imageUrl: string; url: string; }
export interface CatalogSourceResult { source: ProductCatalogSource; connected: boolean; accountName?: string; items: ProductCatalogItem[]; }
export interface Draft { id: string; workspaceId: string; name: string; type: "campaign" | "ad_set" | "ad"; status: "draft" | "review" | "scheduled" | "published"; data: Record<string, unknown>; aiRecommendation?: string; score?: number; scheduledAt?: string; publishedAt?: string; createdAt: string; updatedAt: string; }
export interface AdSet { id: string; campaignId: string; name: string; status: "active" | "paused" | "draft"; dailyBudgetCents: number; targeting: Record<string, unknown>; placements: string[]; bidStrategy: string; startDate?: string; endDate?: string; createdAt: string; updatedAt: string; }
export interface Ad { id: string; adSetId: string; name: string; status: "active" | "paused" | "draft" | "rejected"; creative: { headline: string; body: string; callToAction: string; imageUrl?: string }; format: "single_image" | "carousel" | "video" | "collection"; externalId?: string; createdAt: string; updatedAt: string; }

export type AdInsightNetwork = "meta" | "google" | "tiktok" | "bing";
export interface DistributionSlice { label: string; sharePct: number; }
export interface AudienceInsightItem { name: string; tags: string[]; cpaCents: number | null; spendCents: number; campaignCount: number; }
export interface PageInsightItem { url: string; cvr: number; spendCents: number; campaignCount: number; }
export interface CreativeInsightItem { id: string; headline: string; body: string; imageUrl?: string; ctr: number; cpaCents: number | null; campaignCount: number; }
export interface AdInsightsResponse {
  network: AdInsightNetwork;
  isDemo: boolean;
  audience: { distribution: DistributionSlice[]; top: AudienceInsightItem[] };
  pages: { distribution: DistributionSlice[]; top: PageInsightItem[] };
  creative: { scatter: { id: string; ctr: number; cpaCents: number }[]; topAds: CreativeInsightItem[] };
}

// ── API methods ───────────────────────────────────────────────────────────────
export const api = {
  // Auth
  register: (input: { email: string; password: string; name: string }) =>
    request<AuthResult>("/auth/register", { method: "POST", body: JSON.stringify(input) }),
  login: (email: string, password: string) =>
    request<AuthResult>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),
  googleAuth: (name: string, email: string, googleId: string) =>
    request<AuthResult>("/auth/google", { method: "POST", body: JSON.stringify({ name, email, googleId }) }),
  me: () => request<User>("/auth/me"),

  // Workspaces
  getWorkspace: (id: string) => request<Workspace>(`/workspaces/${id}`),
  updateWorkspace: (id: string, patch: Partial<Omit<Workspace, "id" | "ownerId" | "createdAt">>) =>
    request<Workspace>(`/workspaces/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  listMembers: (workspaceId: string) => request<WorkspaceMember[]>(`/workspaces/${workspaceId}/members`),
  inviteMember: (workspaceId: string, email: string, role: "admin" | "member" | "viewer") =>
    request<WorkspaceMember>(`/workspaces/${workspaceId}/members/invite`, { method: "POST", body: JSON.stringify({ email, role }) }),
  updateMemberRole: (memberId: string, role: string) =>
    request<WorkspaceMember>(`/workspaces/members/${memberId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),
  removeMember: (memberId: string) => request<void>(`/workspaces/members/${memberId}`, { method: "DELETE" }),

  // Notifications
  listNotifications: (workspaceId: string) => request<Notification[]>(`/workspaces/${workspaceId}/notifications`),
  unreadCount: (workspaceId: string) => request<{ count: number }>(`/workspaces/${workspaceId}/notifications/count`),
  markRead: (id: string) => request<Notification>(`/notifications/${id}/read`, { method: "PATCH" }),
  markAllRead: (workspaceId: string) => request<void>(`/workspaces/${workspaceId}/notifications/read-all`, { method: "POST" }),

  // Assets
  listAssets: (workspaceId: string, type?: Asset["type"]) =>
    request<Asset[]>(`/workspaces/${workspaceId}/assets${type ? `?type=${type}` : ""}`),
  createAsset: (workspaceId: string, input: Omit<Asset, "id" | "workspaceId" | "createdAt" | "usageCount">) =>
    request<Asset>(`/workspaces/${workspaceId}/assets`, { method: "POST", body: JSON.stringify(input) }),
  deleteAsset: (id: string) => request<void>(`/assets/${id}`, { method: "DELETE" }),
  updateAssetTags: (id: string, tags: string[]) =>
    request<Asset>(`/assets/${id}/tags`, { method: "PATCH", body: JSON.stringify({ tags }) }),

  // AI Insights
  listInsights: (workspaceId: string) => request<Insight[]>(`/workspaces/${workspaceId}/insights`),
  generateInsights: (workspaceId: string, businessId: string) =>
    request<Insight[]>(`/workspaces/${workspaceId}/insights/generate?businessId=${businessId}`, { method: "POST" }),
  dismissInsight: (id: string) => request<Insight>(`/insights/${id}/dismiss`, { method: "PATCH" }),

  // Integrations
  startMetaOAuth: (workspaceId: string) => `${BASE_URL}/integrations/meta/oauth/start?workspaceId=${encodeURIComponent(workspaceId)}`,
  startGoogleOAuth: (workspaceId: string) => `${BASE_URL}/integrations/google/oauth/start?workspaceId=${encodeURIComponent(workspaceId)}`,
  listIntegrations: (workspaceId: string) => request<Integration[]>(`/workspaces/${workspaceId}/integrations`),
  connectIntegration: (workspaceId: string, platform: Integration["platform"], accountName: string) =>
    request<Integration>(`/workspaces/${workspaceId}/integrations/${platform}/connect`, { method: "POST", body: JSON.stringify({ accountName }) }),
  disconnectIntegration: (workspaceId: string, platform: Integration["platform"]) =>
    request<Integration>(`/workspaces/${workspaceId}/integrations/${platform}/disconnect`, { method: "POST" }),
  updateIntegrationSettings: (workspaceId: string, platform: Integration["platform"], settings: Record<string, unknown>) =>
    request<Integration>(`/workspaces/${workspaceId}/integrations/${platform}/settings`, { method: "PATCH", body: JSON.stringify(settings) }),
  connectMetaManual: (workspaceId: string, input: { accessToken: string; adAccountId: string; pageId?: string; pageAccessToken?: string }) =>
    request<Integration>(`/workspaces/${workspaceId}/integrations/meta/connect-manual`, { method: "POST", body: JSON.stringify(input) }),
  connectGoogleManual: (workspaceId: string, input: { customerId: string; developerToken: string; accessToken: string; clientId?: string; clientSecret?: string; refreshToken?: string }) =>
    request<Integration>(`/workspaces/${workspaceId}/integrations/google/connect-manual`, { method: "POST", body: JSON.stringify(input) }),
  listProductCatalog: (workspaceId: string, source: ProductCatalogSource | "all") =>
    request<CatalogSourceResult[]>(`/workspaces/${workspaceId}/products?source=${source}`),

  // Saved audiences
  listAudiences: (workspaceId: string) => request<SavedAudience[]>(`/workspaces/${workspaceId}/audiences`),
  createAudience: (workspaceId: string, input: Omit<SavedAudience, "id" | "workspaceId" | "createdAt" | "estimatedReach">) =>
    request<SavedAudience>(`/workspaces/${workspaceId}/audiences`, { method: "POST", body: JSON.stringify(input) }),
  deleteAudience: (id: string) => request<void>(`/audiences/${id}`, { method: "DELETE" }),
  getReachEstimate: (workspaceId: string, audienceId: string) =>
    request<ReachEstimate>(`/workspaces/${workspaceId}/audiences/${audienceId}/reach-estimate`, { method: "POST" }),

  // AI creative generation
  createGenerationJob: (workspaceId: string, input: GenerationJobInput) =>
    request<GenerationJob>(`/workspaces/${workspaceId}/generation-jobs`, { method: "POST", body: JSON.stringify(input) }),
  getGenerationJob: (id: string) => request<GenerationJob>(`/generation-jobs/${id}`),

  // Drafts
  listDrafts: (workspaceId: string) => request<Draft[]>(`/workspaces/${workspaceId}/drafts`),
  createDraft: (workspaceId: string, input: Pick<Draft, "name" | "type" | "data" | "aiRecommendation" | "score" | "scheduledAt">) =>
    request<Draft>(`/workspaces/${workspaceId}/drafts`, { method: "POST", body: JSON.stringify(input) }),
  updateDraft: (id: string, patch: Partial<Draft>) => request<Draft>(`/drafts/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  publishDraft: (id: string) => request<Draft>(`/drafts/${id}/publish`, { method: "POST" }),
  scheduleDraft: (id: string, scheduledAt: string) =>
    request<Draft>(`/drafts/${id}/schedule`, { method: "POST", body: JSON.stringify({ scheduledAt }) }),
  deleteDraft: (id: string) => request<void>(`/drafts/${id}`, { method: "DELETE" }),

  // Ad Sets & Ads
  listAdSets: (campaignId: string) => request<AdSet[]>(`/campaigns/${campaignId}/ad-sets`),
  createAdSet: (campaignId: string, input: Omit<AdSet, "id" | "campaignId" | "createdAt" | "updatedAt">) =>
    request<AdSet>(`/campaigns/${campaignId}/ad-sets`, { method: "POST", body: JSON.stringify(input) }),
  listAds: (adSetId: string) => request<Ad[]>(`/ad-sets/${adSetId}/ads`),
  createAd: (adSetId: string, input: Omit<Ad, "id" | "adSetId" | "createdAt" | "updatedAt">) =>
    request<Ad>(`/ad-sets/${adSetId}/ads`, { method: "POST", body: JSON.stringify(input) }),
  updateAd: (id: string, patch: Partial<Pick<Ad, "name" | "status" | "creative" | "format">>) =>
    request<Ad>(`/ads/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  // Onboarding
  scrapeWebsite: (url: string) => request<ScrapedSite>("/onboarding/scrape", { method: "POST", body: JSON.stringify({ url }) }),
  analyzeProduct: (site: ScrapedSite) =>
    request<ProductAnalysis>("/onboarding/analyze-product", { method: "POST", body: JSON.stringify(site) }),
  analyzeAudience: (site: ScrapedSite, product: ProductAnalysis) =>
    request<AudienceAnalysis>("/onboarding/analyze-audience", { method: "POST", body: JSON.stringify({ site, product }) }),
  deepResearch: (url: string) =>
    request<DeepResearchResult>("/onboarding/deep-research", { method: "POST", body: JSON.stringify({ url }) }),
  createResearchSession: (workspaceId: string, url: string, businessId?: string) =>
    request<ResearchSession>(`/workspaces/${workspaceId}/research-sessions`, { method: "POST", body: JSON.stringify({ url, businessId }) }),
  getResearchSession: (id: string) => request<ResearchSession>(`/research-sessions/${id}`),

  // Business
  createBusiness: (input: Omit<BusinessProfile, "id">) =>
    request<BusinessProfile>("/businesses", { method: "POST", body: JSON.stringify(input) }),
  getBusiness: (id: string) => request<BusinessProfile>(`/businesses/${id}`),
  updateBusiness: (id: string, patch: Partial<Omit<BusinessProfile, "id">>) =>
    request<BusinessProfile>(`/businesses/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),

  // Strategy
  generateStrategy: (businessId: string) =>
    request<AdStrategy>(`/businesses/${businessId}/strategies`, { method: "POST" }),
  createStrategyFromResearch: (businessId: string, researchSessionId: string) =>
    request<AdStrategy>(`/businesses/${businessId}/strategies/from-research`, { method: "POST", body: JSON.stringify({ researchSessionId }) }),
  listStrategies: (businessId: string) => request<AdStrategy[]>(`/businesses/${businessId}/strategies`),

  // Campaigns
  createCampaign: (input: { strategyId: string; name: string; dailyBudgetCents: number }) =>
    request<Campaign>("/campaigns", { method: "POST", body: JSON.stringify(input) }),
  listCampaigns: (businessId: string) => request<Campaign[]>(`/businesses/${businessId}/campaigns`),
  getCampaign: (id: string) => request<Campaign>(`/campaigns/${id}`),
  updateCampaign: (id: string, patch: { name?: string; dailyBudgetCents?: number }) =>
    request<Campaign>(`/campaigns/${id}`, { method: "PATCH", body: JSON.stringify(patch) }),
  launchCampaign: (id: string, workspaceId: string = localStorage.getItem("adgo_workspace_id") ?? "demo") =>
    request<Campaign>(`/campaigns/${id}/launch`, { method: "POST", body: JSON.stringify({ workspaceId }) }),
  pauseVariant: (campaignId: string, variantId: string) =>
    request<Campaign>(`/campaigns/${campaignId}/variants/${variantId}/pause`, { method: "POST" }),
  activateVariant: (campaignId: string, variantId: string) =>
    request<Campaign>(`/campaigns/${campaignId}/variants/${variantId}/activate`, { method: "POST" }),
  applyCreativeMedia: (campaignId: string, media: { imageUrl?: string; videoUrl?: string }) =>
    request<Campaign>(`/campaigns/${campaignId}/apply-creative-media`, { method: "POST", body: JSON.stringify(media) }),
  ingestMetrics: (id: string) => request<unknown[]>(`/campaigns/${id}/ingest`, { method: "POST" }),
  getPerformance: (id: string) => request<NormalizedPerformance[]>(`/campaigns/${id}/performance`),
  getCampaignTrend: (id: string) => request<TrendPoint[]>(`/campaigns/${id}/trend`),
  optimize: (id: string) => request<OptimizationDecision[]>(`/campaigns/${id}/optimize`, { method: "POST" }),

  // Analytics
  getAnalyticsSummary: (businessId: string, period: "all" | "month" | "week" = "all") =>
    request<AnalyticsSummary>(`/businesses/${businessId}/analytics/summary?period=${period}`),
  getAudienceSuggestions: (businessId: string) =>
    request<AudienceSuggestion[]>(`/businesses/${businessId}/audience-suggestions`),
  getAdInsights: (businessId: string, network: AdInsightNetwork = "meta") =>
    request<AdInsightsResponse>(`/businesses/${businessId}/ad-insights?network=${network}`),
  chatWithStrategist: (businessId: string, messages: StrategistChatMessage[]) =>
    request<{ reply: string }>(`/businesses/${businessId}/strategist/chat`, { method: "POST", body: JSON.stringify({ messages }) }),

  // Creatives
  listCreatives: (businessId: string) => request<CreativeAsset[]>(`/businesses/${businessId}/creatives`),
  createCreative: (businessId: string, input: { headline: string; body: string; callToAction: string; format?: "text" | "image" | "video"; tags?: string[] }) =>
    request<CreativeAsset>(`/businesses/${businessId}/creatives`, { method: "POST", body: JSON.stringify(input) }),
  deleteCreative: (id: string) => request<void>(`/creatives/${id}`, { method: "DELETE" }),
  generateCreativeVariations: (base: { headline: string; body: string; callToAction: string }) =>
    request<CreativeVariation[]>("/creatives/variations", { method: "POST", body: JSON.stringify(base) }),

  // Billing
  generateInvoice: (businessId: string, periodStart: string, periodEnd: string) =>
    request<Invoice>(`/businesses/${businessId}/invoices`, { method: "POST", body: JSON.stringify({ periodStart, periodEnd }) }),
  listInvoices: (businessId: string) => request<Invoice[]>(`/businesses/${businessId}/invoices`),
};
