-- CreateTable
CREATE TABLE "research_memory_entries" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT,
    "kind" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "embedding" DOUBLE PRECISION[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "research_memory_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "research_memory_entries_workspaceId_idx" ON "research_memory_entries"("workspaceId");

-- CreateIndex
CREATE INDEX "research_memory_entries_kind_idx" ON "research_memory_entries"("kind");
