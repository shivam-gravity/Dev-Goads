import { eventBus } from "./eventBus.js";
import { logger } from "../modules/logger/logger.js";
import type { CampaignLaunchedEvent } from "../modules/orchestrator/campaignOrchestrator.js";

/**
 * Registers every in-process event subscriber. Called once at startup (src/index.ts).
 * When roadmap Phase 3 introduces Kafka, these handlers become the bodies of
 * separate consumer processes — the event contracts they read stay the same.
 */
export function registerEventHandlers(): void {
  eventBus.subscribe<CampaignLaunchedEvent>("campaign.launched", (event) => {
    logger.info(
      `[event:campaign.launched] campaign=${event.payload.campaignId} business=${event.payload.businessId} ` +
        `activeVariants=${event.payload.activeVariants}/${event.payload.totalVariants}`
    );
  });
}
