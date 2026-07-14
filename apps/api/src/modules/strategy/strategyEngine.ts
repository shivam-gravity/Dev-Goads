import { randomUUID } from "node:crypto";
import { openai, runStructured } from "../../infra/openaiClient.js";
import { prisma } from "../../db/prisma.js";
import type { AdCreative, AdNetwork, AdStrategy, AudienceAnalysis, AudiencePersona, BusinessProfile, CampaignSuggestion, CompetitorBudgetAnalysis, MarketLocationAnalysis, ProductAnalysis } from "../../types/index.js";
import type { CampaignAgentOutput, ComplianceAgentOutput, ObjectionHandlingAgentOutput, PricingOfferAgentOutput } from "../../agents/types/index.js";
import type { DecisionContext } from "../../research/decision/types.js";
import { logger } from "../logger/logger.js";
import { truncateForPlatform, PLATFORM_COPY_LIMITS } from "./platformCopyLimits.js";

function isAdNetwork(value: string): value is AdNetwork {
  return value === "meta" || value === "google" || value === "tiktok";
}

// Every strategy-generation path below (LLM-produced, research-derived, or Decision
// Engine-derived) can independently land on a single network for a given business — the
// LLM picks per-strategy platforms freely, and createStrategyFromResearch's marketLocation
// analysis only ever names one recommended platform. Meta + Google are the two networks
// this product actually launches campaigns on today (TikTok shows as "Coming soon" in the
// builder — see generateCampaignSuggestions's own comment), so buildCampaignFromStrategy
// should always have both to build variants for, not whichever single one a strategy
// happened to name. Applied once here rather than duplicated at each call site.
const CORE_NETWORKS: AdNetwork[] = ["meta", "google"];

function ensureCoreNetworks(networks: AdNetwork[]): AdNetwork[] {
  const withCore = new Set(networks);
  for (const network of CORE_NETWORKS) withCore.add(network);
  return [...withCore];
}

/** Fills in a 0 share for any of `networks` missing from `split`, then renormalizes
 * everything to sum to 1 — a network a strategy already scored highly keeps most of its
 * weight; a network only added here to guarantee coverage gets a fair remaining share
 * rather than an arbitrary forced 50/50. */
function ensureCoreBudgetSplit(split: Partial<Record<AdNetwork, number>>, networks: AdNetwork[]): Partial<Record<AdNetwork, number>> {
  const result: Partial<Record<AdNetwork, number>> = { ...split };
  const missing = networks.filter((n) => result[n] === undefined);
  if (missing.length > 0) {
    const alreadyAllocated = Object.values(result).reduce((sum: number, v) => sum + (v ?? 0), 0);
    const remaining = Math.max(1 - alreadyAllocated, 0);
    const perMissing = remaining > 0 ? remaining / missing.length : 1 / networks.length;
    for (const network of missing) result[network] = perMissing;
  }

  const total = Object.values(result).reduce((sum: number, v) => sum + (v ?? 0), 0);
  if (total > 0) {
    for (const network of networks) result[network] = Math.round(((result[network] ?? 0) / total) * 1000) / 1000;
  }
  return result;
}

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
  payload.recommendedNetworks = ensureCoreNetworks(payload.recommendedNetworks);
  payload.budgetSplit = ensureCoreBudgetSplit(payload.budgetSplit, payload.recommendedNetworks);

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

// Every campaign should launch with enough ad variety to actually A/B test — a single
// creative (or the model under-delivering on its own) isn't a real campaign. When a source
// produces fewer than this, we round it out with distinctly-angled variations of the real
// creatives rather than shipping too few ads.
const MIN_CREATIVES = 8;

// Short prefixes, not suffixes, so the distinguishing text survives truncateHeadline's
// slice-from-the-end even when the base headline is already close to MAX_HEADLINE_LENGTH.
const PADDING_ANGLE_TAGS = [
  "Limited Time: ", "New: ", "Trending: ", "Exclusive: ",
  "Best Seller: ", "Just In: ", "Top Pick: ", "Fan Favorite: ",
];

/** Cycles through the real creatives, re-angling each with a distinct prefix tag, until
 * there are at least `min` — every padded entry stays grounded in real generated copy
 * (same body/CTA) instead of inventing generic filler, and headlines stay visibly unique
 * even after truncation since the tag is a prefix, not a suffix. */
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

/** Applied to every creative regardless of source (Claude tool-use, the static fallback,
 * or research-derived) — none of those are guaranteed to respect ad-headline length norms,
 * or to produce enough distinct ads for a real campaign. */
function sanitizeCreatives(creatives: AdCreative[]): AdCreative[] {
  return ensureMinimumCreatives(creatives, MIN_CREATIVES).map((c) => ({ ...c, headline: truncateHeadline(c.headline) }));
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
  const recommendedNetworks = ensureCoreNetworks([network]);
  const strategy: AdStrategy = {
    id: randomUUID(),
    businessId,
    createdAt: new Date().toISOString(),
    summary: `${product.summary} Recommended platform: ${network} in ${marketLocation.recommendedRegion}. ${marketLocation.placementRationale}`,
    recommendedNetworks,
    budgetSplit: ensureCoreBudgetSplit({ [network]: 1 } as Partial<Record<AdNetwork, number>>, recommendedNetworks),
    audiences: personas.length > 0 ? personas.map((p) => p.name) : [audience.primaryAudience],
    creatives,
  };

  return persistStrategy(strategy);
}

/** Turns PricingOfferAgent's recommendation into one concrete creative — the offer type as
 * the headline, positioning/guarantee/urgency stitched into the body, and a CTA inferred
 * from the offer type so "Free trial" doesn't ship with a generic "Learn More" button. A
 * "None recommended" guarantee/urgency (the agent's own fallback phrasing for "not
 * applicable") is dropped rather than shown as a real body line. */
function inferOfferCta(offerType: string): string {
  const t = offerType.toLowerCase();
  if (t.includes("trial")) return "Start Free Trial";
  if (t.includes("discount") || t.includes("% off") || t.includes("off ")) return "Claim Offer";
  if (t.includes("guarantee") || t.includes("risk")) return "Try Risk-Free";
  if (t.includes("demo")) return "Book a Demo";
  return "Get Started";
}

function offerCreativeFrom(offer: PricingOfferAgentOutput): AdCreative {
  const body = [offer.pricingPositioning, offer.guaranteeOrRiskReversal, offer.urgencyAngle]
    .filter((line) => line && !/^none\b/i.test(line))
    .join(" ");
  return { headline: offer.recommendedOfferType, body: body || offer.pricingPositioning, callToAction: inferOfferCta(offer.recommendedOfferType) };
}

// Ad headlines posing the objection as a hook ("Worried about setup time?") leading into the
// rebuttal body is a standard direct-response pattern — distinct from CreativeAgent's general
// copy, which never sees the audience's actual named objections at all.
const MAX_OBJECTION_CREATIVES = 3;

function objectionCreativesFrom(oh: ObjectionHandlingAgentOutput): AdCreative[] {
  return oh.topObjections
    .map((objection, i) => ({ objection, rebuttal: oh.rebuttalAngles[i] }))
    .filter((pair): pair is { objection: string; rebuttal: string } => Boolean(pair.rebuttal))
    .slice(0, MAX_OBJECTION_CREATIVES)
    .map(({ objection, rebuttal }) => ({ headline: objection, body: rebuttal, callToAction: "Learn More" }));
}

/** Non-blocking: ComplianceAgent's finding is attached to the strategy (and logged when
 * high-risk) rather than gating the build — deciding whether a flagged campaign should be
 * hard-blocked from launching is a bigger product decision than this pass makes on its own. */
function complianceWarningFrom(businessId: string, compliance: ComplianceAgentOutput): AdStrategy["complianceWarning"] {
  if (compliance.overallRisk === "low") return undefined;
  if (compliance.overallRisk === "high") {
    logger.warn(`ComplianceAgent flagged HIGH risk for business ${businessId}: ${compliance.recommendation}`);
  }
  return { risk: compliance.overallRisk, flags: compliance.flags, recommendation: compliance.recommendation };
}

export interface AgentStrategyExtras {
  pricingOffer?: PricingOfferAgentOutput | null;
  objectionHandling?: ObjectionHandlingAgentOutput | null;
  compliance?: ComplianceAgentOutput | null;
}

/**
 * Builds and persists an AdStrategy directly from the AI Agent Coordinator's
 * CampaignAgentOutput — the "AI Agents" step for the new agent-pipeline (see
 * agents/AgentCoordinator.ts + workers/campaignGenerationWorker.ts), sibling to
 * createStrategyFromResearch above which serves the older, non-agent
 * ResearchStrategyInput path. Same Strategy shape/persistence either way, so
 * buildCampaignFromStrategy and every downstream campaign-launch/optimization code
 * path work identically regardless of which pipeline produced the strategy.
 *
 * `decisionContext` (optional) is the Decision Intelligence Engine's output for the same
 * ResearchContext, computed concurrently with the agents in campaignGenerationPipeline.ts.
 * When present, its budget allocation/audience priority — a 7-factor ranked recommendation
 * set run through strategy simulation, not a single-pass agent guess — takes precedence over
 * the Campaign Agent's own budgetSplit/recommendedNetworks/audience ordering. The agent's
 * creatives (real generated ad copy) are always kept: the Decision Engine reasons about
 * strategic direction, not literal headline/body/CTA text.
 *
 * `extras` (optional) folds in three more of the 20 agents that previously ran and were
 * persisted but never actually used to build anything: PricingOfferAgent and
 * ObjectionHandlingAgent each contribute real, distinct creatives (not just more
 * CampaignAgent-flavored copy) built from their specific reasoning; ComplianceAgent's
 * finding is attached as a non-blocking warning.
 */
export async function createStrategyFromAgentResults(
  businessId: string,
  output: CampaignAgentOutput,
  decisionContext?: DecisionContext | null,
  extras?: AgentStrategyExtras
): Promise<AdStrategy> {
  const decisionAllocation = decisionContext?.recommendedBudgetAllocation ?? {};
  const decisionNetworks = Object.keys(decisionAllocation).filter(isAdNetwork);

  const budgetSplit: Partial<Record<AdNetwork, number>> = {};
  if (decisionNetworks.length > 0) {
    for (const network of decisionNetworks) budgetSplit[network] = decisionAllocation[network];
  } else {
    for (const [network, fraction] of Object.entries(output.budgetSplit)) {
      if (isAdNetwork(network)) budgetSplit[network] = fraction;
    }
  }

  const recommendedNetworks = ensureCoreNetworks(decisionNetworks.length > 0 ? decisionNetworks : output.recommendedNetworks);
  const normalizedBudgetSplit = ensureCoreBudgetSplit(budgetSplit, recommendedNetworks);

  const audiences = decisionContext?.recommendedAudiencePriority
    ? [decisionContext.recommendedAudiencePriority, ...output.audiences.filter((a) => a !== decisionContext.recommendedAudiencePriority)]
    : output.audiences;

  const offerSummary = extras?.pricingOffer ? ` Offer: ${extras.pricingOffer.recommendedOfferType} — ${extras.pricingOffer.pricingPositioning}` : "";
  const summary = (decisionContext?.recommendedPositioning ? `${output.summary} Positioning: ${decisionContext.recommendedPositioning}` : output.summary) + offerSummary;

  const extraCreatives: AdCreative[] = [
    ...(extras?.pricingOffer ? [offerCreativeFrom(extras.pricingOffer)] : []),
    ...(extras?.objectionHandling ? objectionCreativesFrom(extras.objectionHandling) : []),
  ];

  const strategy: AdStrategy = {
    id: randomUUID(),
    businessId,
    createdAt: new Date().toISOString(),
    summary,
    recommendedNetworks,
    budgetSplit: normalizedBudgetSplit,
    audiences,
    creatives: sanitizeCreatives([...output.creatives, ...extraCreatives]),
    ...(extras?.compliance ? { complianceWarning: complianceWarningFrom(businessId, extras.compliance) } : {}),
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
        headline: truncateForPlatform(`${product.productName}: ${angle}`, PLATFORM_COPY_LIMITS[platform].headline),
        body: truncateForPlatform(product.summary, PLATFORM_COPY_LIMITS[platform].body),
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
      headline: truncateForPlatform(s.headline, PLATFORM_COPY_LIMITS[platform].headline),
      body: truncateForPlatform(s.body, PLATFORM_COPY_LIMITS[platform].body),
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
