-- CreateTable
CREATE TABLE "company_profiles" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "sourceResearchJobId" TEXT,
    "data" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "company_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitors" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "discoverySources" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "refreshIntervalDays" INTEGER NOT NULL DEFAULT 30,
    "lastEnrichedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_profiles" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "positioning" TEXT NOT NULL,
    "pricing" TEXT NOT NULL,
    "targetAudience" TEXT NOT NULL,
    "valueProposition" TEXT NOT NULL,
    "strengths" JSONB NOT NULL,
    "weaknesses" JSONB NOT NULL,
    "technologyStack" JSONB NOT NULL,
    "estimatedMarketingStrategy" TEXT NOT NULL,
    "marketShare" TEXT NOT NULL,
    "estimatedAdBudget" TEXT NOT NULL,
    "differentiation" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "mentionedBySourceCount" INTEGER NOT NULL,
    "citations" JSONB NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "competitor_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competitor_ads" (
    "id" TEXT NOT NULL,
    "competitorId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalAdId" TEXT NOT NULL,
    "headline" TEXT,
    "description" TEXT,
    "cta" TEXT,
    "imageUrl" TEXT,
    "videoUrl" TEXT,
    "landingPageUrl" TEXT,
    "estimatedCountries" JSONB NOT NULL DEFAULT '[]',
    "language" TEXT,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rawSourceData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "competitor_ads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ad_creative_analyses" (
    "id" TEXT NOT NULL,
    "competitorAdId" TEXT NOT NULL,
    "hook" TEXT NOT NULL,
    "painPoint" TEXT NOT NULL,
    "offer" TEXT NOT NULL,
    "emotionalTrigger" TEXT NOT NULL,
    "funnelStage" TEXT NOT NULL,
    "persona" TEXT NOT NULL,
    "creativeStyle" TEXT NOT NULL,
    "messagingStyle" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ad_creative_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recommendations" (
    "id" TEXT NOT NULL,
    "campaignGenerationJobId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "objective" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "dailyBudgetCents" INTEGER NOT NULL,
    "campaignStructure" JSONB NOT NULL,
    "adSets" JSONB NOT NULL,
    "creatives" JSONB NOT NULL,
    "headlines" JSONB NOT NULL,
    "primaryText" TEXT NOT NULL,
    "cta" TEXT NOT NULL,
    "landingPageRecommendation" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "company_profiles_businessId_key" ON "company_profiles"("businessId");

-- CreateIndex
CREATE INDEX "company_profiles_workspaceId_idx" ON "company_profiles"("workspaceId");

-- CreateIndex
CREATE INDEX "competitors_businessId_idx" ON "competitors"("businessId");

-- CreateIndex
CREATE INDEX "competitors_workspaceId_idx" ON "competitors"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "competitors_businessId_name_key" ON "competitors"("businessId", "name");

-- CreateIndex
CREATE INDEX "competitor_profiles_competitorId_idx" ON "competitor_profiles"("competitorId");

-- CreateIndex
CREATE INDEX "competitor_profiles_competitorId_generatedAt_idx" ON "competitor_profiles"("competitorId", "generatedAt");

-- CreateIndex
CREATE INDEX "competitor_ads_competitorId_idx" ON "competitor_ads"("competitorId");

-- CreateIndex
CREATE INDEX "competitor_ads_competitorId_isActive_idx" ON "competitor_ads"("competitorId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "competitor_ads_competitorId_platform_externalAdId_key" ON "competitor_ads"("competitorId", "platform", "externalAdId");

-- CreateIndex
CREATE UNIQUE INDEX "ad_creative_analyses_competitorAdId_key" ON "ad_creative_analyses"("competitorAdId");

-- CreateIndex
CREATE INDEX "campaign_recommendations_campaignGenerationJobId_idx" ON "campaign_recommendations"("campaignGenerationJobId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recommendations_campaignGenerationJobId_rank_key" ON "campaign_recommendations"("campaignGenerationJobId", "rank");

-- AddForeignKey
ALTER TABLE "competitor_profiles" ADD CONSTRAINT "competitor_profiles_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "competitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competitor_ads" ADD CONSTRAINT "competitor_ads_competitorId_fkey" FOREIGN KEY ("competitorId") REFERENCES "competitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ad_creative_analyses" ADD CONSTRAINT "ad_creative_analyses_competitorAdId_fkey" FOREIGN KEY ("competitorAdId") REFERENCES "competitor_ads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
