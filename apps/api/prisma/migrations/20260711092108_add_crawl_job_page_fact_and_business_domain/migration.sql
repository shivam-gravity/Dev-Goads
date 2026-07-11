-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "domain" TEXT;

-- CreateTable
CREATE TABLE "crawl_jobs" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "researchJobId" TEXT,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "pagesDiscovered" INTEGER NOT NULL DEFAULT 0,
    "pagesCrawled" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crawl_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_pages" (
    "id" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "pageType" TEXT,
    "title" TEXT,
    "relevanceScore" DOUBLE PRECISION,
    "contentHash" TEXT,
    "cleanedText" TEXT,
    "rawHtmlKey" TEXT,
    "screenshotKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'fetched',
    "error" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crawl_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crawl_facts" (
    "id" TEXT NOT NULL,
    "crawlJobId" TEXT NOT NULL,
    "crawlPageId" TEXT,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crawl_facts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crawl_jobs_businessId_idx" ON "crawl_jobs"("businessId");

-- CreateIndex
CREATE INDEX "crawl_jobs_workspaceId_idx" ON "crawl_jobs"("workspaceId");

-- CreateIndex
CREATE INDEX "crawl_pages_crawlJobId_idx" ON "crawl_pages"("crawlJobId");

-- CreateIndex
CREATE INDEX "crawl_facts_crawlJobId_idx" ON "crawl_facts"("crawlJobId");

-- CreateIndex
CREATE INDEX "crawl_facts_crawlPageId_idx" ON "crawl_facts"("crawlPageId");

-- CreateIndex
CREATE UNIQUE INDEX "businesses_workspaceId_domain_key" ON "businesses"("workspaceId", "domain");

-- AddForeignKey
ALTER TABLE "crawl_jobs" ADD CONSTRAINT "crawl_jobs_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_pages" ADD CONSTRAINT "crawl_pages_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "crawl_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_facts" ADD CONSTRAINT "crawl_facts_crawlJobId_fkey" FOREIGN KEY ("crawlJobId") REFERENCES "crawl_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crawl_facts" ADD CONSTRAINT "crawl_facts_crawlPageId_fkey" FOREIGN KEY ("crawlPageId") REFERENCES "crawl_pages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

