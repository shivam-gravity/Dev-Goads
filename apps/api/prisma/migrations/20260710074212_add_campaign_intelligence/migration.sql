-- CreateTable
CREATE TABLE "campaign_performance_snapshots" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT,
    "industry" TEXT,
    "platform" TEXT,
    "impressions" INTEGER NOT NULL,
    "clicks" INTEGER NOT NULL,
    "conversions" INTEGER NOT NULL,
    "spendCents" INTEGER NOT NULL,
    "revenueCents" INTEGER NOT NULL,
    "ctr" DOUBLE PRECISION NOT NULL,
    "cpcCents" DOUBLE PRECISION,
    "cpaCents" DOUBLE PRECISION,
    "roas" DOUBLE PRECISION,
    "frequency" DOUBLE PRECISION,
    "metadata" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "campaign_performance_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_feedback" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT,
    "recommendationId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "campaignId" TEXT,
    "outcomeSummary" TEXT,
    "effectivenessScore" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "success_patterns" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "creative" TEXT NOT NULL,
    "offer" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "occurrences" INTEGER NOT NULL DEFAULT 1,
    "avgRoas" DOUBLE PRECISION,
    "avgCtr" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "success_patterns_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_performance_snapshots_campaignId_idx" ON "campaign_performance_snapshots"("campaignId");

-- CreateIndex
CREATE INDEX "campaign_performance_snapshots_workspaceId_idx" ON "campaign_performance_snapshots"("workspaceId");

-- CreateIndex
CREATE INDEX "campaign_performance_snapshots_industry_idx" ON "campaign_performance_snapshots"("industry");

-- CreateIndex
CREATE INDEX "campaign_performance_snapshots_platform_idx" ON "campaign_performance_snapshots"("platform");

-- CreateIndex
CREATE INDEX "recommendation_feedback_workspaceId_idx" ON "recommendation_feedback"("workspaceId");

-- CreateIndex
CREATE INDEX "recommendation_feedback_campaignId_idx" ON "recommendation_feedback"("campaignId");

-- CreateIndex
CREATE INDEX "recommendation_feedback_workspaceId_category_title_idx" ON "recommendation_feedback"("workspaceId", "category", "title");

-- CreateIndex
CREATE INDEX "success_patterns_workspaceId_idx" ON "success_patterns"("workspaceId");
