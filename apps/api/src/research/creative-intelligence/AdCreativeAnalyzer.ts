import { randomUUID } from "node:crypto";
import { openai, runStructured } from "../../infra/openaiClient.js";
import { prisma } from "../../db/prisma.js";
import { logger } from "../../modules/logger/logger.js";

/**
 * Per-ad Creative Intelligence — analyzes ONE specific advertisement's actual headline/
 * description, distinct from CreativeIntelligenceEngine.ts's per-COMPETITOR aggregate
 * messaging analysis (which runs a fresh web search per competitor). This never searches
 * the web: it extracts structure from the ad content CompetitorAdDiscovery already
 * captured, so it's cheap enough to run on every newly-discovered ad without an extra
 * research call.
 */

export interface AdCreativeAnalysisFields {
  hook: string;
  painPoint: string;
  offer: string;
  emotionalTrigger: string;
  cta: string;
  funnelStage: string;
  persona: string;
  creativeStyle: string;
  messagingStyle: string;
}

const AD_CREATIVE_TOOL = {
  name: "emit_ad_creative_analysis",
  description: "Analyze one specific advertisement's actual creative and return a structured breakdown.",
  input_schema: {
    type: "object" as const,
    properties: {
      hook: { type: "string", description: "The opening line/visual that grabs attention" },
      painPoint: { type: "string", description: "The problem/frustration this ad addresses" },
      offer: { type: "string", description: "The specific offer/promotion/deal in this ad, or \"None\" if it's brand awareness" },
      emotionalTrigger: { type: "string", description: "e.g. \"Fear of missing out\", \"Aspiration\", \"Relief\", \"Trust/authority\"" },
      cta: { type: "string", description: "The call-to-action text/intent" },
      funnelStage: { type: "string", description: "e.g. \"Awareness\", \"Consideration\", \"Decision\", \"Retention\"" },
      persona: { type: "string", description: "Who this specific ad appears to target" },
      creativeStyle: { type: "string", description: "e.g. \"UGC/testimonial\", \"Product demo\", \"Lifestyle\", \"Comparison\", \"Text-only\"" },
      messagingStyle: { type: "string", description: "e.g. \"Direct/urgent\", \"Educational\", \"Humorous\", \"Aspirational\"" },
    },
    required: ["hook", "painPoint", "offer", "emotionalTrigger", "cta", "funnelStage", "persona", "creativeStyle", "messagingStyle"],
  },
};

function fallbackFields(): AdCreativeAnalysisFields {
  return {
    hook: "Unknown — no live analysis performed.",
    painPoint: "Unknown",
    offer: "Unknown",
    emotionalTrigger: "Unknown",
    cta: "Unknown",
    funnelStage: "Unknown",
    persona: "Unknown",
    creativeStyle: "Unknown",
    messagingStyle: "Unknown",
  };
}

function computeConfidence(usedFallback: boolean, hasContent: boolean): number {
  if (usedFallback) return 0.1;
  return hasContent ? 0.7 : 0.4;
}

export interface AdForAnalysis {
  id: string;
  platform: string;
  headline: string | null;
  description: string | null;
  cta: string | null;
  landingPageUrl: string | null;
}

/** Pure model call — no DB I/O, so it's directly unit-testable. */
export async function analyzeAdCreative(ad: AdForAnalysis): Promise<AdCreativeAnalysisFields & { confidence: number }> {
  const hasContent = Boolean(ad.headline || ad.description);
  if (!openai || !hasContent) {
    return { ...fallbackFields(), confidence: computeConfidence(true, hasContent) };
  }

  const structured = await runStructured<AdCreativeAnalysisFields>({
    maxTokens: 512,
    tool: AD_CREATIVE_TOOL,
    messages: [
      {
        role: "user",
        content: `Analyze this ${ad.platform} advertisement's creative:\n\nHeadline: ${ad.headline ?? "(none)"}\nBody: ${ad.description ?? "(none)"}\nCTA: ${ad.cta ?? "(none)"}\nLanding page: ${ad.landingPageUrl ?? "(none)"}`,
      },
    ],
  });

  const usedFallback = !structured;
  return { ...(structured ?? fallbackFields()), confidence: computeConfidence(usedFallback, hasContent) };
}

/**
 * Runs analyzeAdCreative for every CompetitorAd belonging to `competitorId` that doesn't
 * already have an AdCreativeAnalysis row, and persists the result. Best-effort per-ad: one
 * ad's analysis failing (a schema mismatch, a transient API error) never stops the rest
 * from being analyzed.
 */
export async function analyzeNewCompetitorAds(competitorId: string): Promise<number> {
  const ads = await prisma.competitorAd.findMany({
    where: { competitorId, creativeAnalysis: null },
    select: { id: true, platform: true, headline: true, description: true, cta: true, landingPageUrl: true },
  });

  let analyzed = 0;
  for (const ad of ads) {
    try {
      const fields = await analyzeAdCreative(ad);
      await prisma.adCreativeAnalysis.create({ data: { id: randomUUID(), competitorAdId: ad.id, ...fields } });
      analyzed++;
    } catch (err) {
      logger.warn(`analyzeNewCompetitorAds: failed to analyze/persist ad ${ad.id}`, err);
    }
  }
  return analyzed;
}
