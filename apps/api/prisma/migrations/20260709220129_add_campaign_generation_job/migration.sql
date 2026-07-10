-- CreateTable
CREATE TABLE "campaign_generation_jobs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "name" TEXT,
    "dailyBudgetCents" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "researchJobId" TEXT,
    "strategyId" TEXT,
    "campaignId" TEXT,
    "agentResults" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "campaign_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_generation_jobs_workspaceId_idx" ON "campaign_generation_jobs"("workspaceId");

-- CreateIndex
CREATE INDEX "campaign_generation_jobs_businessId_idx" ON "campaign_generation_jobs"("businessId");
