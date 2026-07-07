-- CreateTable
CREATE TABLE "research_sessions" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "currentStep" TEXT,
    "blocks" JSONB NOT NULL DEFAULT '[]',
    "personas" JSONB,
    "result" JSONB,
    "error" TEXT,
    "searchCount" INTEGER NOT NULL DEFAULT 0,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_sessions_workspaceId_idx" ON "research_sessions"("workspaceId");

-- CreateIndex
CREATE INDEX "research_sessions_url_idx" ON "research_sessions"("url");
