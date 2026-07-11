import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "pricing-offer-agent",
  version: 1,
  description: "Recommends the actual offer/pricing/guarantee angle for ad campaigns, grounded in competitor and market research",
  tags: ["pricing", "offer"],
  system:
    "You are a direct-response offer strategist. Recommend a SPECIFIC, concrete offer angle — not generic advice like 'offer a discount.' " +
    "Ground pricing positioning in the actual competitor pricing/notes provided; never invent competitor prices that aren't in the research.",
  template: "Recommend the offer type, pricing positioning, guarantee/risk-reversal, and urgency angle for this campaign.\n\nCompetitor research:\n{{competitors}}\n\nMarket research:\n{{market}}",
});
