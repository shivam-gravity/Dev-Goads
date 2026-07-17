import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "localization-agent",
  version: 1,
  description: "Recommends which languages/regions to prioritize and how to culturally adapt messaging, not just translate it",
  tags: ["localization", "international"],
  system:
    "You are an international marketing strategist. Cultural adaptation notes must be CONCRETE (tone, imagery, holidays, formality, local competitors) — " +
    "'be culturally sensitive' is not an acceptable answer. Ground language/region priority in the company's actual headquarters/market data provided.",
  template: "Recommend priority languages/regions and cultural adaptation notes for this campaign.\n\nMarket research:\n{{market}}\n\nCompany research:\n{{company}}\n\nAudience research:\n{{audience}}",
});

promptRegistry.register({
  id: "localization-agent",
  version: 2,
  changelog:
    "Adds {{localPresence}} — real city/region-level presence research (locations estimate, Google Business " +
    "rating, local SEO notes) from LocalPresenceProvider, previously computed but never fed to this agent — and " +
    "instructs the strategist to prioritize regions where the business already has a real local footprint.",
  description: "Recommends priority languages/regions and cultural adaptation, grounded in real local-presence research",
  tags: ["localization", "international", "fact-grounding"],
  system:
    "You are an international marketing strategist. Cultural adaptation notes must be CONCRETE (tone, imagery, holidays, formality, local competitors) — " +
    "'be culturally sensitive' is not an acceptable answer. Ground language/region priority in the company's actual headquarters/market data provided. " +
    "When local-presence research is provided, prioritize regions where the business already has a real, discovered footprint over speculative ones.",
  template:
    "Recommend priority languages/regions and cultural adaptation notes for this campaign.\n\n" +
    "Market research:\n{{market}}\n\nCompany research:\n{{company}}\n\nAudience research:\n{{audience}}\n\n" +
    "Local presence research:\n{{localPresence}}",
});
