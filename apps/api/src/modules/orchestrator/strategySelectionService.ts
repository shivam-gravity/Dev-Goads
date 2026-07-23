import { randomUUID } from "node:crypto";
import type { AdCreative, AdNetwork, Campaign, CampaignVariant } from "../../types/index.js";
import type { CampaignStrategy, DecisionContext } from "../../research/decision/types.js";
import type { AgentResult, CampaignAgentOutput } from "../../agents/types/index.js";
import { getCampaignGenerationJob, type CampaignGenerationJobRecord } from "./campaignGenerationService.js";
import { getCampaign, saveCampaign } from "./campaignOrchestrator.js";
import { applyCopyLimitsForNetwork } from "../strategy/platformCopyLimits.js";
import { getBusiness } from "../business/businessService.js";
import { isActiveNetwork } from "../../config/platforms.js";
import { logger } from "../logger/logger.js";

/**
 * Materializes ONE of a generation job's 3 candidate Decision-Engine strategies (Strategy
 * A/B/C — decisionContext.strategies) into a real, editable draft Campaign, so the results
 * page can offer "3 complete campaign suggestions" the user picks between rather than only
 * ever building the auto-selected winner.
 *
 * This deliberately reuses data the pipeline ALREADY computed — the candidate strategy's own
 * objective/budget/audience/messaging plus the Campaign Agent's real generated ad creatives
 * (persisted on the job's agentResults) — so selecting a suggestion is a cheap synthesis, not
 * a fresh research/LLM run. It mirrors buildCampaignFromStrategy's creatives × networks
 * cross-product so every suggestion lands the user in the builder with a full Meta + Google
 * ad set, matching what the winning-strategy campaign already provides.
 */

const MIN_CREATIVES_PER_NETWORK = 3;

// Same short-prefix padding idea as strategyEngine.ensureMinimumCreatives: keep every padded
// creative grounded in real generated copy (same body/CTA) while staying visibly distinct.
const PADDING_ANGLE_TAGS = ["Limited Time: ", "New: ", "Trending: ", "Exclusive: ", "Best Seller: "];

const LANDING_PAGE_SLUGS = ["", "offer", "checkout", "pricing"];

// Map the Decision Engine's human objective label (Awareness/Traffic/Conversions/Sales/…) onto a
// real post-ODAX Meta objective code so the built campaign launches with the objective the chosen
// strategy actually recommends, not the pipeline default. Unknown/free-text labels fall through to
// undefined (the orchestrator then uses its own default), never a crash.
const OBJECTIVE_LABEL_TO_META: Record<string, string> = {
  awareness: "OUTCOME_AWARENESS",
  reach: "OUTCOME_AWARENESS",
  traffic: "OUTCOME_TRAFFIC",
  engagement: "OUTCOME_ENGAGEMENT",
  leads: "OUTCOME_LEADS",
  "lead generation": "OUTCOME_LEADS",
  conversions: "OUTCOME_SALES",
  conversion: "OUTCOME_SALES",
  sales: "OUTCOME_SALES",
  purchase: "OUTCOME_SALES",
};

function metaObjectiveForStrategy(strategy: CampaignStrategy): string | undefined {
  return OBJECTIVE_LABEL_TO_META[strategy.objective.trim().toLowerCase()];
}

function ensureMinimumCreatives(creatives: AdCreative[], min: number): AdCreative[] {
  if (creatives.length === 0 || creatives.length >= min) return creatives;
  const padded = [...creatives];
  let angle = 0;
  while (padded.length < min) {
    const base = creatives[padded.length % creatives.length];
    padded.push({ ...base, headline: `${PADDING_ANGLE_TAGS[angle % PADDING_ANGLE_TAGS.length]}${base.headline}` });
    angle++;
  }
  return padded;
}

/** The concrete ad creatives to seed a suggestion's variants with — the Campaign Agent's real
 * generated copy when the job persisted it, else a single grounded fallback derived from the
 * strategy's own messaging/offer so an agentless/degraded run still produces editable ads. */
function creativesForStrategy(job: CampaignGenerationJobRecord, strategy: CampaignStrategy): AdCreative[] {
  const campaignAgent = job.agentResults?.["campaign-agent"] as AgentResult<CampaignAgentOutput> | undefined;
  const agentCreatives = campaignAgent?.data.creatives ?? [];
  if (agentCreatives.length > 0) {
    return agentCreatives.map((c) => ({ headline: c.headline, body: c.body, callToAction: c.callToAction }));
  }
  return [
    {
      headline: strategy.messaging?.slice(0, 40) || strategy.label,
      body: strategy.offer || strategy.creativeDirection || "Discover what makes us different.",
      callToAction: "Learn More",
    },
  ];
}

export interface SelectStrategyResult {
  campaign: Campaign;
  /** True when we returned the pipeline's already-built winning campaign as-is (no new build). */
  reusedWinner: boolean;
}

/**
 * Builds (or reuses) the editable draft Campaign for a chosen candidate strategy of a completed
 * generation job. The winning strategy's campaign was already built by the pipeline, so selecting
 * it returns that campaign unchanged; selecting a non-winner builds a fresh draft on demand.
 *
 * `strategyRef` matches a candidate by id ("strategy-a") OR label ("Strategy A"), case-insensitively.
 */
export async function buildCampaignForSelectedStrategy(jobId: string, strategyRef: string): Promise<SelectStrategyResult> {
  const job = await getCampaignGenerationJob(jobId);
  if (!job) throw new Error(`Campaign generation job ${jobId} not found`);
  const decision = job.decisionContext;
  if (!decision || decision.strategies.length === 0) {
    throw new Error("This generation job has no candidate strategies to build from");
  }

  const ref = strategyRef.trim().toLowerCase();
  const strategy = decision.strategies.find((s) => s.id.toLowerCase() === ref || s.label.toLowerCase() === ref);
  if (!strategy) throw new Error(`Strategy "${strategyRef}" not found among this job's candidates`);

  // The winner (rank 1) is exactly the strategy the pipeline already materialized into job.campaignId —
  // return it as-is rather than rebuilding a near-identical duplicate campaign.
  const winner = decision.simulations.find((s) => s.rank === 1);
  const isWinner = winner?.strategyId === strategy.id;
  if (isWinner && job.campaignId) {
    const existing = await getCampaign(job.campaignId);
    if (existing) return { campaign: existing, reusedWinner: true };
  }

  const business = await getBusiness(job.businessId);
  const baseUrl = business?.website?.replace(/\/$/, "") ?? job.url.replace(/\/$/, "") ?? "https://example.com";

  // Only build for networks we can actually launch on (config/platforms.ts) — a candidate can
  // still name only one platform; the results-page suggestion promises "Meta + Google", so default
  // to both launchable networks when the strategy narrowed itself to fewer.
  const strategyNetworks = strategy.platforms.filter((p): p is AdNetwork => isActiveNetwork(p as AdNetwork));
  const launchableNetworks: AdNetwork[] = strategyNetworks.length > 0 ? strategyNetworks : (["meta", "google"] as AdNetwork[]);

  const creatives = ensureMinimumCreatives(creativesForStrategy(job, strategy), MIN_CREATIVES_PER_NETWORK);

  let variantIndex = 0;
  const variants: CampaignVariant[] = creatives.flatMap((creative) =>
    launchableNetworks.map((network) => {
      const audienceName = strategy.targetAudience || "General Audience";
      const slug = LANDING_PAGE_SLUGS[variantIndex % LANDING_PAGE_SLUGS.length];
      variantIndex++;
      return {
        id: randomUUID(),
        creative: applyCopyLimitsForNetwork(creative, network),
        network,
        status: "draft" as const,
        audienceName,
        landingPageUrl: slug ? `${baseUrl}/${slug}` : `${baseUrl}/`,
      };
    })
  );

  const campaign: Campaign = {
    id: randomUUID(),
    businessId: job.businessId,
    ...(business?.workspaceId ? { workspaceId: business.workspaceId } : { workspaceId: job.workspaceId }),
    // Attribute to the persisted AdStrategy the pipeline built for this job (shared across
    // candidates), falling back to the candidate's own id so this required field is never empty.
    strategyId: job.strategyId ?? strategy.id,
    name: `${job.name ?? business?.brandName ?? business?.name ?? job.url} — ${strategy.label}`,
    status: "draft",
    networks: launchableNetworks,
    dailyBudgetCents: job.dailyBudgetCents ?? strategy.budgetDailyCents ?? 2000,
    variants,
    ...(metaObjectiveForStrategy(strategy) ? { objective: metaObjectiveForStrategy(strategy) } : {}),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await saveCampaign(campaign);
  logger.info(`Built on-demand campaign ${campaign.id} for candidate ${strategy.label} of generation job ${jobId} (${variants.length} variants)`);
  return { campaign, reusedWinner: false };
}
