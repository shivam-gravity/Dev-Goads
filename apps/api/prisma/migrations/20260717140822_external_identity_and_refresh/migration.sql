-- NOTE (branch-merge reconciliation): this migration and 20260718100000_add_auth_crm_and_refresh_tokens
-- came from two divergent branches that were later merged. BOTH originally did `CREATE TABLE
-- "refresh_tokens"`, with different shapes, so on a fresh database (CI) the second one failed with
-- 42P07 "relation already exists". The canonical schema is the one in 20260718100000 + schema.prisma
-- (refresh_tokens with family/replacedBy; no partners table; no businesses/users external* columns —
-- those artifacts are used nowhere in the app). This migration is therefore rewritten to be fully
-- IDEMPOTENT and to NOT create refresh_tokens (20260718100000 owns it): every statement is guarded so
-- it's a harmless no-op both on a fresh DB and on any environment where the original already applied.

-- AlterTable (external-identity columns — kept idempotent; unused by the app today but harmless)
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "businesses" ADD COLUMN IF NOT EXISTS "source" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "externalId" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "externalUser" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'native';

-- CreateTable
CREATE TABLE IF NOT EXISTS "partners" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "businessId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'crm',
    "externalId" TEXT,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- refresh_tokens is intentionally NOT created here — 20260718100000_add_auth_crm_and_refresh_tokens
-- creates the canonical (family/replacedBy) shape. Creating it here first is exactly what broke CI.

-- CreateIndex
CREATE INDEX IF NOT EXISTS "partners_workspaceId_idx" ON "partners"("workspaceId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "partners_businessId_idx" ON "partners"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "partners_source_externalId_key" ON "partners"("source", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "businesses_externalId_idx" ON "businesses"("externalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "users_source_externalId_key" ON "users"("source", "externalId");
