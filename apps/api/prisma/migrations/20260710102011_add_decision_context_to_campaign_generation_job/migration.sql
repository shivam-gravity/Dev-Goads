-- Additive only: adds decisionContext to the existing campaign_generation_jobs table.
-- Hand-written (not via `prisma migrate dev`) because that command's shadow-database
-- diff engine incorrectly proposed dropping campaign_performance_snapshots,
-- recommendation_feedback, and success_patterns (all populated) — those tables are
-- untouched by this migration; only the new nullable column below is added.
ALTER TABLE "campaign_generation_jobs" ADD COLUMN "decisionContext" JSONB;
