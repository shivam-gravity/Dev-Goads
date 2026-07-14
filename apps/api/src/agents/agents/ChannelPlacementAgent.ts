import { z } from "zod";
import type { AIAgent } from "../interfaces/AIAgent.js";
import { callAgentModel, collectEvidence, computeConfidence, runAgentStep } from "../support.js";
import type { AgentResult, ChannelPlacementAgentOutput, ResearchContext } from "../types/index.js";

const CHANNEL_PLACEMENT_AGENT_TOOL = {
  name: "emit_channel_placement_agent_result",
  description: "Return specific placement recommendations within each network, not just which networks to use.",
  input_schema: {
    type: "object" as const,
    properties: {
      recommendedPlacements: {
        type: "array",
        minItems: 1,
        maxItems: 8,
        items: {
          type: "object",
          properties: {
            network: { type: "string", description: "e.g. Meta, Google, TikTok" },
            placement: { type: "string", description: "e.g. Stories, Reels, Feed, Search, Display, YouTube In-Stream, For You Feed" },
            rationale: { type: "string" },
          },
          required: ["network", "placement", "rationale"],
        },
      },
      devicePriority: { type: "string", description: "e.g. \"Mobile-first — audience research shows primarily mobile browsing\"" },
    },
    required: ["recommendedPlacements", "devicePriority"],
  },
};

const channelPlacementAgentSchema: z.ZodType<ChannelPlacementAgentOutput> = z.object({
  recommendedPlacements: z.array(z.object({ network: z.string(), placement: z.string(), rationale: z.string() })),
  devicePriority: z.string(),
});

function fallback(): ChannelPlacementAgentOutput {
  return {
    recommendedPlacements: [{ network: "Meta", placement: "Feed", rationale: "Safe default — no live audience/social research available" }],
    devicePriority: "Unknown — no live research available.",
  };
}

/** Recommends specific ad PLACEMENTS within each network (Stories vs. Feed vs. Reels,
 * Search vs. Display vs. YouTube) rather than just which networks to use — grounded in
 * audience behavior, device signals, and social media presence, independent of every
 * other agent. */
export class ChannelPlacementAgent implements AIAgent<ChannelPlacementAgentOutput> {
  readonly name = "channel-placement-agent";
  readonly promptId = "channel-placement-agent";

  async execute(context: ResearchContext): Promise<AgentResult<ChannelPlacementAgentOutput>> {
    return runAgentStep(this.name, async () => {
      const fields = ["audience", "technology", "socialMedia", "localPresence", "appStore", "videoPresence"] as const;
      const { data, promptVersion, usedFallback, modelSource } = await callAgentModel({
        promptId: this.promptId,
        vars: {
          audience: JSON.stringify(context.audience ?? {}),
          technology: JSON.stringify(context.technology ?? {}),
          socialMedia: JSON.stringify(context.socialMedia ?? {}),
          localPresence: JSON.stringify(context.localPresence ?? {}),
          appStore: JSON.stringify(context.appStore ?? {}),
          videoPresence: JSON.stringify(context.videoPresence ?? {}),
        },
        tool: CHANNEL_PLACEMENT_AGENT_TOOL,
        schema: channelPlacementAgentSchema,
        maxTokens: 768,
        fallback,
      });
      return {
        data,
        promptId: this.promptId,
        promptVersion,
        usedFallback,
        modelSource,
        confidence: computeConfidence(context, [...fields], usedFallback),
        evidence: collectEvidence(context, [...fields]),
      };
    });
  }
}
