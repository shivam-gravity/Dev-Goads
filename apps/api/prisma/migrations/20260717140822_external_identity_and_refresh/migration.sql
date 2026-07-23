-- AlterTable
ALTER TABLE "businesses" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "source" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "externalUser" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'native';

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'crm',
    "externalId" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "workspaceId" TEXT,
    "businessId" TEXT,
    "partnerId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "partners_workspaceId_idx" ON "partners"("workspaceId");

-- CreateIndex
CREATE INDEX "partners_businessId_idx" ON "partners"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "partners_source_externalId_key" ON "partners"("source", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");

-- CreateIndex
CREATE INDEX "businesses_externalId_idx" ON "businesses"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX "users_source_externalId_key" ON "users"("source", "externalId");

