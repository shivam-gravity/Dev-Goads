import { openai, runStructured, runWebSearch } from "../../infra/openaiClient.js";
import { hostnameOf } from "../providers/support.js";
import { readMemory, writeMemory } from "../memory/MemoryCoordinator.js";
import type { Citation } from "../../types/index.js";

/**
 * Audience Intelligence — synthesizes who actually buys from a business (or should) from
 * 3 inputs: the business's own site/positioning, review-site chatter (real complaints and
 * praise are a much better pain-point/objection signal than marketing copy), and prior
 * Research Memory for similar businesses. Competitor context is accepted optionally
 * (e.g. from a prior Competitor Intelligence Engine run) since who a business's
 * competitors target is a real signal for who IT should target too, but this engine never
 * runs its own competitor discovery — that's Competitor Intelligence's job, not
 * duplicated here.
 */

export interface AudienceIntelligenceInput {
  url: string;
  businessName?: string;
  industry?: string;
  workspaceId: string;
  businessId?: string;
  /** Optional — competitor names already known (e.g. from runCompetitorIntelligence),
   * folded into the prompt as extra context. Never independently discovered here. */
  competitorNames?: string[];
}

/** One weighted fit criterion — `weight` (0-1) is this criterion's relative importance to
 * overall fit, so a caller scoring a real lead/account against this ICP can compute a
 * weighted match score instead of only having prose to display. Two groups (firmographic
 * vs. behavioral) because they answer different questions: "is this the kind of company we
 * should target at all" vs. "is this account showing signals it's ready to buy right now." */
export interface ICPCriterion {
  criterion: string;
  weight: number;
}

export interface IdealCustomerProfile {
  summary: string;
  firmographics: ICPCriterion[];
  behavioralSignals: ICPCriterion[];
}

/** One role in the buying committee, with its relative influence over the purchase
 * decision — distinct from `decisionMakers` (a flat title list): this is *who's in the
 * room and how much weight they carry*. */
export interface BuyingCommitteeRole {
  role: string;
  influence: string;
}

/** One stage of the path from first awareness to becoming a customer. */
export interface CustomerJourneyStage {
  stage: string;
  description: string;
}

export interface AudienceIntelligenceReport {
  icp: IdealCustomerProfile;
  decisionMakers: string[];
  buyingTriggers: string[];
  painPoints: string[];
  objections: string[];
  motivations: string[];
  channels: string[];
  buyingCommittee: BuyingCommitteeRole[];
  /** How the buying committee's roles relate/report to each other for this kind of purchase. */
  decisionHierarchy: string;
  /** The role that actually controls/signs off on budget for this kind of purchase. */
  budgetOwner: string;
  /** Typical steps/duration from first evaluation to signed deal. */
  procurementCycle: string;
  /** The stages a buyer moves through from first awareness to becoming a customer. */
  customerJourney: CustomerJourneyStage[];
  evidence: string[];
  citations: Citation[];
  confidence: number;
  generatedAt: string;
}

const MEMORY_KIND = "audience-profile";

const AUDIENCE_TOOL = {
  name: "emit_audience_intelligence",
  description: "Return a structured audience-intelligence profile for a business.",
  input_schema: {
    type: "object" as const,
    properties: {
      icp: {
        type: "object",
        description: "Structured Ideal Customer Profile, not just a description — weighted so a real lead/account can be scored against it",
        properties: {
          summary: { type: "string", description: "1-2 sentence Ideal Customer Profile description" },
          firmographics: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              properties: { criterion: { type: "string", description: "e.g. \"Company size: 50-500 employees\", \"Industry: B2B SaaS\", \"Geography: North America\"" }, weight: { type: "number", minimum: 0, maximum: 1 } },
              required: ["criterion", "weight"],
            },
            description: "Company-level fit criteria (industry, size, geography, revenue band, tech stack), each weighted by relative importance to overall fit",
          },
          behavioralSignals: {
            type: "array",
            minItems: 2,
            maxItems: 6,
            items: {
              type: "object",
              properties: { criterion: { type: "string", description: "e.g. \"Recently raised a funding round\", \"Hiring surge in relevant roles\", \"Actively evaluating competitor tools\"" }, weight: { type: "number", minimum: 0, maximum: 1 } },
              required: ["criterion", "weight"],
            },
            description: "Behavioral/intent signals indicating a prospect is a good fit RIGHT NOW, each weighted by relative importance",
          },
        },
        required: ["summary", "firmographics", "behavioralSignals"],
      },
      decisionMakers: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Job titles/roles typically involved in the buying decision" },
      buyingTriggers: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Events/situations that prompt someone to start looking for this kind of product" },
      painPoints: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6 },
      objections: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Reasons a prospect hesitates or says no" },
      motivations: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Underlying goals/outcomes the audience actually wants" },
      channels: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 6, description: "Where this audience can realistically be reached (platforms, communities, publications)" },
      buyingCommittee: {
        type: "array",
        minItems: 1,
        maxItems: 6,
        items: {
          type: "object",
          properties: {
            role: { type: "string", description: "Job title/role in the buying committee" },
            influence: { type: "string", description: "This role's relative influence over the purchase decision, e.g. \"Final approver\", \"Champion/influencer\", \"Blocker/gatekeeper\"" },
          },
          required: ["role", "influence"],
        },
        description: "Who's in the room for this kind of purchase decision, and how much weight each role carries",
      },
      decisionHierarchy: { type: "string", description: "How the buying committee's roles relate/report to each other for this kind of purchase" },
      budgetOwner: { type: "string", description: "The role that actually controls/signs off on budget for this kind of purchase" },
      procurementCycle: { type: "string", description: "Typical steps/duration from first evaluation to signed deal" },
      customerJourney: {
        type: "array",
        minItems: 3,
        maxItems: 6,
        items: {
          type: "object",
          properties: { stage: { type: "string", description: "e.g. \"Awareness\", \"Consideration\", \"Evaluation\", \"Decision\", \"Onboarding\"" }, description: { type: "string", description: "What's actually happening/needed at this stage for this audience" } },
          required: ["stage", "description"],
        },
        description: "The stages a buyer moves through from first awareness to becoming a customer",
      },
    },
    required: ["icp", "decisionMakers", "buyingTriggers", "painPoints", "objections", "motivations", "channels", "buyingCommittee", "decisionHierarchy", "budgetOwner", "procurementCycle", "customerJourney"],
  },
};

type AudienceFields = Omit<AudienceIntelligenceReport, "evidence" | "citations" | "confidence" | "generatedAt">;

function fallbackFields(businessName: string): AudienceFields {
  return {
    icp: {
      summary: `Unknown — no live research performed for ${businessName}.`,
      firmographics: [],
      behavioralSignals: [],
    },
    decisionMakers: ["Not yet researched"],
    buyingTriggers: ["Not yet researched"],
    painPoints: ["Not yet researched"],
    objections: ["Not yet researched"],
    motivations: ["Not yet researched"],
    channels: ["Not yet researched"],
    buyingCommittee: [],
    decisionHierarchy: "Unknown — no live research performed.",
    budgetOwner: "Unknown — no live research performed.",
    procurementCycle: "Unknown — no live research performed.",
    customerJourney: [],
  };
}

/** Confidence combines citation count (a real signal was found at all) with whether
 * Research Memory corroborated this run with prior findings on a similar business — same
 * spirit as CompetitorProvider/Competitor Intelligence's confidence formulas, tuned
 * separately since this is a different kind of synthesis (one profile from 2 searches,
 * not N independently-enriched entities). */
function computeConfidence(usedFallback: boolean, citationCount: number, hadMemoryCorroboration: boolean): number {
  if (usedFallback) return 0.1;
  const base = citationCount === 0 ? 0.4 : Math.min(0.55 + citationCount * 0.07, 0.9);
  return Math.round(Math.min(base + (hadMemoryCorroboration ? 0.05 : 0), 1) * 100) / 100;
}

async function searchAudienceSignals(input: AudienceIntelligenceInput): Promise<{ narrative: string; citations: Citation[] }> {
  const subject = input.businessName ?? hostnameOf(input.url);
  const research = await runWebSearch(
    `Who is the target audience/ideal customer profile for the business at ${input.url}${input.businessName ? ` ("${input.businessName}")` : ""} in ${input.industry ?? "its category"}? Include likely decision-maker roles and their relative influence (buying committee), the decision-making hierarchy, who typically owns/controls budget, the typical procurement cycle, what triggers someone to buy, how they'd typically be reached, and the stages a buyer typically moves through from first awareness to becoming a customer.`
  );
  return { narrative: research.narrative, citations: research.citations };
}

async function searchReviewSignals(input: AudienceIntelligenceInput): Promise<{ narrative: string; citations: Citation[] }> {
  const subject = input.businessName ?? hostnameOf(input.url);
  const research = await runWebSearch(
    `Find real customer reviews, complaints, and testimonials about "${subject}" (${input.industry ?? "its category"}). What pain points do customers mention, and what objections or hesitations come up before they buy?`
  );
  return { narrative: research.narrative, citations: research.citations };
}

/**
 * Runs the full Audience Intelligence pipeline: gathers signal from a direct
 * ICP/decision-maker search, a review/complaint search, and Research Memory, then makes
 * one structured-extraction pass synthesizing all of it into the 7 output dimensions.
 * Persists the result to Research Memory (kind: "audience-profile") via the Memory
 * Coordinator, deduped by business identity, so a later run refreshes rather than
 * duplicates. Never throws: degrades to a labeled, low-confidence fallback with zero
 * network calls when there's no OPENAI_API_KEY.
 */
export async function runAudienceIntelligence(input: AudienceIntelligenceInput): Promise<AudienceIntelligenceReport> {
  const businessLabel = input.businessName ?? hostnameOf(input.url);
  const dedupKey = input.businessId ?? input.url;

  if (!openai) {
    return {
      ...fallbackFields(businessLabel),
      evidence: [],
      citations: [],
      confidence: computeConfidence(true, 0, false),
      generatedAt: new Date().toISOString(),
    };
  }

  const memoryQueryText = `${businessLabel} — ${input.industry ?? "its category"}`;
  const [audienceSignal, reviewSignal, priorMatches] = await Promise.all([
    searchAudienceSignals(input),
    searchReviewSignals(input),
    readMemory({ kind: MEMORY_KIND, queryText: memoryQueryText, workspaceId: input.workspaceId, excludeBusinessId: input.businessId, topK: 2 }),
  ]);

  const memoryContext = priorMatches.length > 0
    ? `\n\nPrior audience research on similar businesses (Research Memory — verify before relying on it):\n${priorMatches.map((m) => `- ${m.content}`).join("\n")}`
    : "";
  const competitorContext = input.competitorNames?.length ? `\n\nKnown competitors: ${input.competitorNames.join(", ")}.` : "";

  const structured = await runStructured<AudienceFields>({
    maxTokens: 1024,
    tool: AUDIENCE_TOOL,
    messages: [
      {
        role: "user",
        content: `Synthesize an audience-intelligence profile for "${businessLabel}" (${input.industry ?? "its category"}) from this research.\n\nTarget-audience research:\n${audienceSignal.narrative}\n\nReview/complaint research:\n${reviewSignal.narrative}${competitorContext}${memoryContext}`,
      },
    ],
  });

  const usedFallback = !structured;
  const fields = structured ?? fallbackFields(businessLabel);
  const citations = usedFallback ? [] : [...audienceSignal.citations, ...reviewSignal.citations];

  const report: AudienceIntelligenceReport = {
    ...fields,
    evidence: citations.map((c) => `${c.title} (${c.url})`),
    citations,
    confidence: computeConfidence(usedFallback, citations.length, priorMatches.length > 0),
    generatedAt: new Date().toISOString(),
  };

  if (!usedFallback) {
    try {
      await writeMemory({
        workspaceId: input.workspaceId,
        businessId: input.businessId,
        kind: MEMORY_KIND,
        sourceUrl: input.url,
        dedupKey,
        content: `${businessLabel}: ICP - ${report.icp.summary} Pain points: ${report.painPoints.join("; ")}. Channels: ${report.channels.join(", ")}.`,
        metadata: report as unknown as Record<string, unknown>,
      });
    } catch {
      // Research Memory is an enhancement, never a reason to fail the report.
    }
  }

  return report;
}
