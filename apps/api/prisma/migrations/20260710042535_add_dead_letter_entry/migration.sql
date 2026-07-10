-- CreateTable
CREATE TABLE "dead_letter_entries" (
    "id" TEXT NOT NULL,
    "queue" TEXT NOT NULL,
    "jobName" TEXT NOT NULL,
    "jobData" JSONB NOT NULL,
    "error" TEXT NOT NULL,
    "attemptsMade" INTEGER NOT NULL,
    "failedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dead_letter_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dead_letter_entries_queue_idx" ON "dead_letter_entries"("queue");
