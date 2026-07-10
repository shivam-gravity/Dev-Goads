import { randomUUID } from "node:crypto";
import { openai, runStructured } from "../../infra/openaiClient.js";
import { prisma } from "../../db/prisma.js";
import type { AdCreative, AdNetwork, AdStrategy, AudienceAnalysis, AudiencePersona, BusinessProfile, CampaignSuggestion, CompetitorBudgetAnalysis, MarketLocationAnalysis, ProductAnalysis } from "../../types/index.js";
import type { CampaignAgentOutput } from "../../agents/types/index.js";

async function persistStrategy(strategy: AdStrategy): Promise<AdStrategy> {
  await prisma.strategy.create({
    data: { id: strategy.id, businessId: strategy.businessId, data: strategy as any, createdAt: new Date(strategy.createdAt) },
  });
  return strategy;
}

const STRATEGY_TOOL = {
  name: "emit_ad_strategy",
  description: "Return a structured ad strategy for the given business.",
  input_schema: {
    type: "object" as const,
    properties: {
      summary: { type: "string", description: "2-3 sentence strategy overview" },
      recommendedNetworks: {
        type: "array",
        items: { type: "string", enum: ["meta", "google", "tiktok"] },
      },
      budgetSplit: {
        type: "object",
        properties: { meta: { type: "number" }, google: { type: "number" }, tiktok: { type: "number" } },
        required: ["meta", "google"],
      },
      audiences: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 5 },
      creatives: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            headline: { type: "string" },
            body: { type: "string" },
            callToAction: { type: "string" },
          },
          required: ["headline", "body", "callToAction"],
        },
      },
    },
    required: ["summary", "recommendedNetworks", "budgetSplit", "audiences", "creatives"],
  },
};

function fallbackStrategy(business: BusinessProfile): Omit<AdStrategy, "id" | "businessId" | "createdAt"> {
  return {
    summary: `A balanced acquisition strategy for ${business.name} in ${business.industry}, splitting spend across search intent capture and social awareness while validating creative angles against stated goals: ${business.goals.join(", ")}.`,
    recommendedNetworks: ["google", "meta"],
    budgetSplit: { meta: 0.5, google: 0.5 },
    audiences: [business.targetAudience ?? `${business.industry} decision makers`, "Lookalike of existing customers", "Retargeting: site visitors (30d)"],
    creatives: [
      { headline: `${business.name}: Built for ${business.industry}`, body: "See why teams switch to us in weeks, not quarters.", callToAction: "Get Started" },
      { headline: `Stop losing time to manual ${business.industry} work`, body: "Automate the busywork and focus on what matters.", callToAction: "Learn More" },
    ],
  };
}

export async function generateStrategy(business: BusinessProfile): Promise<AdStrategy> {
  let payload: Omit<AdStrategy, "id" | "businessId" | "createdAt">;

  if (openai) {
    const result = await runStructured<typeof payload>({
      maxTokens: 1024,
      tool: STRATEGY_TOOL,
      messages: [
        {
          role: "user",
          content: `Design a paid-ads strategy for this business:\n${JSON.stringify(business, null, 2)}\n\nBudget split values must be fractions that sum to 1.`,
        },
      ],
    });
    if (!result) throw new Error("Strategy engine: model did not return structured output");
    payload = result;
  } else {
    payload = fallbackStrategy(business);
  }
  payload.creatives = sanitizeCreatives(payload.creatives);

  const strategy: AdStrategy = {
    id: randomUUID(),
    businessId: business.id,
    createdAt: new Date().toISOString(),
    ...payload,
  };

  return persistStrategy(strategy);
}

export async function getStrategy(id: string): Promise<AdStrategy | null> {
  const row = await prisma.strategy.findUnique({ where: { id } });
  return row ? (row.data as unknown as AdStrategy) : null;
}

export async function listStrategiesForBusiness(businessId: string): Promise<AdStrategy[]> {
  const rows = await prisma.strategy.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } });
  return rows.map((r) => r.data as unknown as AdStrategy);
}

export interface ResearchStrategyInput {
  product: ProductAnalysis;
  audience: AudienceAnalysis;
  competitorBudget: CompetitorBudgetAnalysis;
  marketLocation: MarketLocationAnalysis;
  personas: AudiencePersona[];
}

// Meta/Google ad headlines are conventionally short (~25-40 chars) and the CampaignBuilder
// headline input enforces maxLength=40 — truncate with an ellipsis rather than let a longer
// research-derived phrase (e.g. a full valueProposition sentence) overflow the ad preview.
const MAX_HEADLINE_LENGTH = 40;

function truncateHeadline(text: string, max = MAX_HEADLINE_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** Applied to every creative regardless of source (Claude tool-use, the static fallback,
 * or research-derived) — none of those are guaranteed to respect ad-headline length norms. */
function sanitizeCreatives(creatives: AdCreative[]): AdCreative[] {
  return creatives.map((c) => ({ ...c, headline: truncateHeadline(c.headline) }));
}

/**
 * Builds and persists an AdStrategy directly from an already-completed deep-research
 * session — deliberately skips generateStrategy's Claude call above, since re-deriving a
 * strategy from scratch would throw away the much richer research (real competitor names,
 * a calculated budget, named audience personas) already gathered for this exact business.
 * Same Strategy shape/persistence as generateStrategy, so existing campaign-launch code
 * reading budgetSplit/recommendedNetworks/creatives works identically either way.
 */
export async function createStrategyFromResearch(businessId: string, input: ResearchStrategyInput): Promise<AdStrategy> {
  const { product, audience, marketLocation, personas } = input;

  const creatives: AdCreative[] = sanitizeCreatives([
    {
      headline: product.productName,
      body: `${product.summary} ${product.valueProposition}`.trim(),
      callToAction: "Learn More",
    },
    {
      headline: product.keyFeatures[0] ? `${product.keyFeatures[0]} — built for ${product.category}` : product.productName,
      body: audience.primaryAudience,
      callToAction: "Get Started",
    },
  ]);

  const network: AdNetwork = marketLocation.recommendedPlatform;
  const strategy: AdStrategy = {
    id: randomUUID(),
    businessId,
    createdAt: new Date().toISOString(),
    summary: `${product.summary} Recommended platform: ${network} in ${marketLocation.recommendedRegion}. ${marketLocation.placementRationale}`,
    recommendedNetworks: [network],
    budgetSplit: { [network]: 1 } as Partial<Record<AdNetwork, number>>,
    audiences: personas.length > 0 ? personas.map((p) => p.name) : [audience.primaryAudience],
    creatives,
  };

  return persistStrategy(strategy);
}

/**
 * Builds and persists an AdStrategy directly from the AI Agent Coordinator's
 * CampaignAgentOutput — the "AI Agents" step for the new agent-pipeline (see
 * agents/AgentCoordinator.ts + workers/campaignGenerationWorker.ts), sibling to
 * createStrategyFromResearch above which serves the older, non-agent
 * ResearchStrategyInput path. Same Strategy shape/persistence either way, so
 * buildCampaignFromStrategy and every downstream campaign-launch/optimization code
 * path work identically regardless of which pipeline produced the strategy.
 */
export async function createStrategyFromAgentResults(businessId: string, output: CampaignAgentOutput): Promise<AdStrategy> {
  const budgetSplit: Partial<Record<AdNetwork, number>> = {};
  for (const [network, fraction] of Object.entries(output.budgetSplit)) {
    if (network === "meta" || network === "google" || network === "tiktok") {
      budgetSplit[network] = fraction;
    }
  }

  const strategy: AdStrategy = {
    id: randomUUID(),
    businessId,
    createdAt: new Date().toISOString(),
    summary: output.summary,
    recommendedNetworks: output.recommendedNetworks,
    budgetSplit,
    audiences: output.audiences,
    creatives: sanitizeCreatives(output.creatives),
  };

  return persistStrategy(strategy);
}

// TikTok is deliberately excluded here — the builder shows it as "Coming soon" rather than a
// real launchable option, so suggestions are only ever generated for meta/google.
const SUGGESTION_ITEM_SCHEMA = {
  type: "object" as const,
  properties: {
    title: { type: "string", description: "Short internal label for the card, e.g. 'Social proof — Feed'" },
    description: { type: "string", description: "1-2 sentence pitch shown on the card" },
    hashtags: { type: "array", items: { type: "string" }, minItems: 3, maxItems: 8, description: "Without the '#' prefix" },
    headline: { type: "string", description: "Ad headline, under 40 characters" },
    body: { type: "string", description: "Ad body copy" },
    callToAction: { type: "string" },
    imagePrompt: { type: "string", description: "Vivid prompt for an image-generation model: subject, setting, lighting, mood — no text/typography in the image" },
  },
  required: ["title", "description", "hashtags", "headline", "body", "callToAction", "imagePrompt"],
};

const CAMPAIGN_SUGGESTIONS_TOOL = {
  name: "emit_campaign_suggestions",
  description: "Return exactly 6 distinct Meta campaign suggestions and exactly 6 distinct Google campaign suggestions (12 total) derived from this business's research.",
  input_schema: {
    type: "object" as const,
    properties: {
      metaSuggestions: { type: "array", minItems: 6, maxItems: 6, items: SUGGESTION_ITEM_SCHEMA, description: "Exactly 6 Meta (Facebook/Instagram) campaign angles" },
      googleSuggestions: { type: "array", minItems: 6, maxItems: 6, items: SUGGESTION_ITEM_SCHEMA, description: "Exactly 6 Google Ads campaign angles" },
    },
    required: ["metaSuggestions", "googleSuggestions"],
  },
};

const FALLBACK_SUGGESTION_ANGLES = ["Social proof", "Feature highlight", "Limited-time offer", "Customer story", "Value & pricing", "Curiosity"];

/** Zero-LLM-call fallback so a missing OPENAI_API_KEY never blocks the suggestions step — cycles
 * through a fixed angle list against whatever personas research already found, once per platform. */
function fallbackCampaignSuggestions(input: ResearchStrategyInput): CampaignSuggestion[] {
  const { product, personas } = input;
  const basis = personas.length > 0 ? personas : [{ name: "General audience", ageRange: "", genderSplit: "", details: "", interests: [product.category] }];

  const forPlatform = (platform: AdNetwork): CampaignSuggestion[] =>
    FALLBACK_SUGGESTION_ANGLES.map((angle, i) => {
      const persona = basis[i % basis.length];
      return {
        id: randomUUID(),
        title: `${angle} — ${persona.name}`,
        description: `A ${angle.toLowerCase()} angle for ${product.productName}, targeting ${persona.name.toLowerCase()}.`,
        hashtags: [product.category, ...persona.interests.slice(0, 3)].filter(Boolean).map((t) => `#${t.replace(/\s+/g, "")}`),
        platform,
        headline: truncateHeadline(`${product.productName}: ${angle}`),
        body: product.summary,
        callToAction: "Learn More",
        imagePrompt: `A clean, scroll-stopping ad hero image for ${product.productName}, emphasizing ${angle.toLowerCase()}. No text or typography in the image.`,
      };
    });

  return [...forPlatform("meta"), ...forPlatform("google")];
}

/** Turns a completed research session into 12 distinct campaign angles (6 Meta + 6 Google) that
 * become the campaign's ads directly (see createStrategyFromSuggestions/buildCampaignFromSuggestions) —
 * no separate pre-builder pick-one step. TikTok is excluded — shown as "Coming soon" in the builder. */
export async function generateCampaignSuggestions(input: ResearchStrategyInput): Promise<CampaignSuggestion[]> {
  if (!openai) return fallbackCampaignSuggestions(input);

  type SuggestionItem = Omit<CampaignSuggestion, "id" | "platform">;
  const result = await runStructured<{ metaSuggestions: SuggestionItem[]; googleSuggestions: SuggestionItem[] }>({
    maxTokens: 4096,
    tool: CAMPAIGN_SUGGESTIONS_TOOL,
    messages: [
      {
        role: "user",
        content:
          `Generate exactly 6 distinct Meta campaign suggestions and exactly 6 distinct Google campaign suggestions for this business, ` +
          `each taking a different creative angle (e.g. social proof, urgency, feature highlight, curiosity, comparison, value/pricing) ` +
          `so the user has real variety to choose from on each platform.\n\n` +
          `Product analysis:\n${JSON.stringify(input.product, null, 2)}\n\n` +
          `Audience analysis:\n${JSON.stringify(input.audience, null, 2)}\n\n` +
          `Competitor/budget analysis:\n${JSON.stringify(input.competitorBudget, null, 2)}\n\n` +
          `Market/location analysis:\n${JSON.stringify(input.marketLocation, null, 2)}\n\n` +
          `Audience personas:\n${JSON.stringify(input.personas, null, 2)}`,
      },
    ],
  });
  if (!result) return fallbackCampaignSuggestions(input);

  const withPlatform = (items: SuggestionItem[], platform: AdNetwork): CampaignSuggestion[] =>
    items.map((s) => ({
      ...s,
      id: randomUUID(),
      platform,
      headline: truncateHeadline(s.headline),
      hashtags: s.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`)),
    }));

  return [...withPlatform(result.metaSuggestions, "meta"), ...withPlatform(result.googleSuggestions, "google")];
}

/**
 * Builds and persists a single AdStrategy spanning ALL of a session's campaign suggestions —
 * one creative per suggestion, `recommendedNetworks` the de-duped set of platforms they cover.
 * Feeds buildCampaignFromSuggestions, which turns each creative into its own CampaignVariant
 * (rather than the creatives × recommendedNetworks cross-product createStrategyFromResearch's
 * strategy would get if run through buildCampaignFromStrategy) so every suggestion becomes
 * exactly one ad on its own intended platform, not one ad per platform per suggestion.
 */
export async function createStrategyFromSuggestions(businessId: string, input: ResearchStrategyInput, suggestions: CampaignSuggestion[]): Promise<AdStrategy> {
  const { audience, personas } = input;
  const networks = [...new Set(suggestions.map((s) => s.platform))];

  const strategy: AdStrategy = {
    id: randomUUID(),
    businessId,
    createdAt: new Date().toISOString(),
    summary: `${suggestions.length} campaign angles generated from research: ${suggestions.map((s) => s.title).join("; ")}.`,
    recommendedNetworks: networks,
    budgetSplit: Object.fromEntries(networks.map((n) => [n, 1 / networks.length])) as Partial<Record<AdNetwork, number>>,
    audiences: personas.length > 0 ? personas.map((p) => p.name) : [audience.primaryAudience],
    creatives: sanitizeCreatives(suggestions.map((s) => ({ headline: s.headline, body: s.body, callToAction: s.callToAction }))),
  };

  return persistStrategy(strategy);
}
