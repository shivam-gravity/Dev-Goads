-- CreateTable
CREATE TABLE "lead_forms" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "campaignId" TEXT,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lead_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "leadFormId" TEXT,
    "campaignId" TEXT,
    "adId" TEXT,
    "fullName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "companyName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "submittedAt" TIMESTAMP(3) NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lead_forms_workspaceId_idx" ON "lead_forms"("workspaceId");

-- CreateIndex
CREATE INDEX "lead_forms_workspaceId_platform_idx" ON "lead_forms"("workspaceId", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "lead_forms_workspaceId_platform_externalId_key" ON "lead_forms"("workspaceId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "leads_workspaceId_submittedAt_idx" ON "leads"("workspaceId", "submittedAt");

-- CreateIndex
CREATE INDEX "leads_workspaceId_platform_idx" ON "leads"("workspaceId", "platform");

-- CreateIndex
CREATE INDEX "leads_leadFormId_idx" ON "leads"("leadFormId");

-- CreateIndex
CREATE INDEX "leads_campaignId_idx" ON "leads"("campaignId");

-- CreateIndex
CREATE INDEX "leads_email_idx" ON "leads"("email");

-- CreateIndex
CREATE UNIQUE INDEX "leads_workspaceId_platform_externalId_key" ON "leads"("workspaceId", "platform", "externalId");

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_leadFormId_fkey" FOREIGN KEY ("leadFormId") REFERENCES "lead_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;
