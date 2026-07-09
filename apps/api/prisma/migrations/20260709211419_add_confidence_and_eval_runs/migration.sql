-- AlterTable
ALTER TABLE "provider_executions" ADD COLUMN     "confidence" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "ai_evaluation_runs" (
    "id" TEXT NOT NULL,
    "suite" TEXT NOT NULL,
    "target" TEXT,
    "totalCases" INTEGER NOT NULL,
    "passedCases" INTEGER NOT NULL,
    "avgScore" DOUBLE PRECISION NOT NULL,
    "avgConfidence" DOUBLE PRECISION,
    "cases" JSONB NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ai_evaluation_runs_suite_idx" ON "ai_evaluation_runs"("suite");

-- CreateIndex
CREATE INDEX "ai_evaluation_runs_suite_target_idx" ON "ai_evaluation_runs"("suite", "target");
