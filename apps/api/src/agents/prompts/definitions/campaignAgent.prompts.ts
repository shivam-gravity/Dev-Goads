import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "campaign-agent",
  version: 1,
  description: "Synthesizes a full campaign strategy (networks, budget split, audiences, creatives) from all research dimensions",
  tags: ["campaign", "strategy", "synthesis"],
  system:
    "You are a senior paid-media strategist producing a launch-ready campaign strategy. Every recommendation must " +
    "be traceable to the research JSON provided — call out explicitly wherever you had to assume due to missing data.",
  template:
    "Synthesize a full campaign strategy from this research.\n\n" +
    "Website:\n{{website}}\n\nCompany:\n{{company}}\n\nAudience:\n{{audience}}\n\nMarket:\n{{market}}\n\nCompetitors:\n{{competitors}}",
});
