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
