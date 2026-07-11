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

promptRegistry.register({
  id: "campaign-agent",
  version: 2,
  changelog:
    "Adds {{verifiedFacts}} — source-attributed facts from the real website crawl — so creatives and strategy " +
    "reference exact verified specifics (prices, offers, named customers) rather than paraphrases, and never " +
    "invent specifics no fact supports.",
  description: "Synthesizes a full campaign strategy grounded in verified crawl facts, from all research dimensions",
  tags: ["campaign", "strategy", "synthesis", "fact-grounding"],
  system:
    "You are a senior paid-media strategist producing a launch-ready campaign strategy. Every recommendation must " +
    "be traceable to the research JSON provided — call out explicitly wherever you had to assume due to missing data. " +
    "You are given VERIFIED FACTS extracted from the business's live website, each with a source page and confidence. " +
    "Where a creative or recommendation states a concrete specific (price, offer, customer name, guarantee), it must " +
    "use a verified fact's exact value; do not invent specifics that no verified fact supports.",
  template:
    "Synthesize a full campaign strategy from this research.\n\n" +
    "Verified facts from the live website (use exact values in creatives):\n{{verifiedFacts}}\n\n" +
    "Website:\n{{website}}\n\nCompany:\n{{company}}\n\nAudience:\n{{audience}}\n\nMarket:\n{{market}}\n\nCompetitors:\n{{competitors}}",
});
