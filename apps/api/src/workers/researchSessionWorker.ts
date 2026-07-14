import "dotenv/config";
import { Worker, type Job } from "bullmq";
import { redisConnection, RESEARCH_SESSION_QUEUE } from "../infra/queue.js";
import { scrapeUrl } from "../modules/onboarding/scraper.js";
import { analyzeProductDeep, analyzeAudienceDeep, analyzeCompetitorsAndBudget, analyzeMarketAndLocation, mineAudiencePersonas, RESEARCH_STEPS } from "../modules/onboarding/marketResearch.js";
import {
  appendResearchBlock,
  markResearchSessionRunning,
  markResearchSessionDone,
  markResearchSessionFailed,
  setResearchSessionCurrentStep,
  setResearchSessionPersonas,
  MAX_SEARCHES_PER_SESSION,
} from "../modules/onboarding/researchSessionService.js";
import { isFinalFailure, sendToDeadLetter } from "../infra/deadLetterQueue.js";
import { registerGracefulShutdown } from "../infra/gracefulShutdown.js";
import { logger } from "../modules/logger/logger.js";
import { initErrorTracking, registerCrashReporting, captureError } from "../infra/errorTracking.js";

initErrorTracking("polluxa-research-session-worker");
registerCrashReporting("polluxa-research-session-worker");

/**
 * Standalone process — run with `npm run dev:research-worker --workspace apps/api`
 * alongside the gateway, same pattern as creativeGenerationWorker.ts. A full research
 * session (multiple web-search-backed Claude calls per block) is slow enough that it
 * has to run outside the request/response cycle, same reasoning as creative generation.
 */
const worker = new Worker(
  RESEARCH_SESSION_QUEUE,
  async (job: Job) => {
    const { sessionId, url } = job.data as { sessionId: string; url: string };
    await markResearchSessionRunning(sessionId);

    try {
      const site = await scrapeUrl(url);

      // Session-level search cap: once a block's real searches push the running total
      // to the cap, every subsequent block runs with allowSearch=false — a no-search
      // reasoning fallback rather than an error, so one runaway/expensive block can't
      // sink the rest of the session or blow the budget.
      let searchesSoFar = 0;
      const budgetOk = () => searchesSoFar < MAX_SEARCHES_PER_SESSION;

      await setResearchSessionCurrentStep(sessionId, RESEARCH_STEPS.productPositioning);
      const productBlock = await analyzeProductDeep(site, budgetOk());
      searchesSoFar += productBlock.citations.length > 0 ? 1 : 0;
      await appendResearchBlock(sessionId, productBlock, productBlock.citations.length > 0 ? 1 : 0);

      await setResearchSessionCurrentStep(sessionId, RESEARCH_STEPS.audienceProfile);
      const audienceBlock = await analyzeAudienceDeep(site, productBlock.data, budgetOk());
      searchesSoFar += audienceBlock.citations.length > 0 ? 1 : 0;
      await appendResearchBlock(sessionId, audienceBlock, audienceBlock.citations.length > 0 ? 1 : 0);

      await setResearchSessionCurrentStep(sessionId, RESEARCH_STEPS.competitorBudget);
      const competitorBlock = await analyzeCompetitorsAndBudget(site, productBlock.data, budgetOk());
      searchesSoFar += competitorBlock.citations.length > 0 ? 1 : 0;
      await appendResearchBlock(sessionId, competitorBlock, competitorBlock.citations.length > 0 ? 1 : 0);

      await setResearchSessionCurrentStep(sessionId, RESEARCH_STEPS.marketLocation);
      const marketBlock = await analyzeMarketAndLocation(site, productBlock.data, budgetOk());
      searchesSoFar += marketBlock.citations.length > 0 ? 1 : 0;
      await appendResearchBlock(sessionId, marketBlock, marketBlock.citations.length > 0 ? 1 : 0);

      // No search budget check here — persona mining never spends real searches
      // (see mineAudiencePersonas's doc comment), so it always runs regardless of budgetOk().
      await setResearchSessionCurrentStep(sessionId, RESEARCH_STEPS.audiencePersonas);
      const personasBlock = await mineAudiencePersonas(site, productBlock.data, audienceBlock.data, competitorBlock.data);
      const session = await appendResearchBlock(sessionId, personasBlock, 0);
      await setResearchSessionPersonas(sessionId, personasBlock.data);

      await markResearchSessionDone(sessionId, {
        site,
        product: productBlock.data,
        audience: audienceBlock.data,
        competitorBudget: competitorBlock.data,
        marketLocation: marketBlock.data,
        personas: personasBlock.data,
      });
      return session;
    } catch (err) {
      await markResearchSessionFailed(sessionId, err instanceof Error ? err.message : "Research session failed");
      throw err;
    }
  },
  { connection: redisConnection, concurrency: 3 }
);

worker.on("completed", (job: Job) => logger.info(`Research session completed: ${job.data?.sessionId}`));
worker.on("failed", (job: Job | undefined, err: Error) => {
  logger.error(`Research session failed: ${job?.data?.sessionId}`, err);
  captureError(err, { worker: "researchSessionWorker", sessionId: job?.data?.sessionId });
  if (job && isFinalFailure(job)) void sendToDeadLetter(RESEARCH_SESSION_QUEUE, job, err);
});

registerGracefulShutdown(worker, "researchSessionWorker");
logger.info("Research session worker listening for jobs");
