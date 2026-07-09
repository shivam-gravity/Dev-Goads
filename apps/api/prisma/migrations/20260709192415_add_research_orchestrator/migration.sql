-- CreateTable
CREATE TABLE "research_jobs" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "context" JSONB,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "research_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_executions" (
    "id" TEXT NOT NULL,
    "researchJobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "data" JSONB,
    "citations" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provider_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_snapshots" (
    "id" TEXT NOT NULL,
    "researchJobId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "context" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "research_evidence" (
    "id" TEXT NOT NULL,
    "researchJobId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "snippet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_jobs_workspaceId_idx" ON "research_jobs"("workspaceId");

-- CreateIndex
CREATE INDEX "research_jobs_businessId_idx" ON "research_jobs"("businessId");

-- CreateIndex
CREATE INDEX "research_jobs_url_idx" ON "research_jobs"("url");

-- CreateIndex
CREATE INDEX "provider_executions_researchJobId_idx" ON "provider_executions"("researchJobId");

-- CreateIndex
CREATE INDEX "provider_executions_researchJobId_provider_idx" ON "provider_executions"("researchJobId", "provider");

-- CreateIndex
CREATE INDEX "research_snapshots_researchJobId_idx" ON "research_snapshots"("researchJobId");

-- CreateIndex
CREATE INDEX "research_evidence_researchJobId_idx" ON "research_evidence"("researchJobId");

-- CreateIndex
CREATE INDEX "research_evidence_researchJobId_provider_idx" ON "research_evidence"("researchJobId", "provider");

-- AddForeignKey
ALTER TABLE "provider_executions" ADD CONSTRAINT "provider_executions_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "research_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_snapshots" ADD CONSTRAINT "research_snapshots_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "research_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "research_evidence" ADD CONSTRAINT "research_evidence_researchJobId_fkey" FOREIGN KEY ("researchJobId") REFERENCES "research_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
