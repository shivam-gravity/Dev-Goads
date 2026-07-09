import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "creative-agent",
  version: 1,
  description: "Generates ad copy angles (headlines, primary text, CTA) from website/audience/company research",
  tags: ["creative", "copywriting"],
  system:
    "You are a direct-response ad copywriter. Write headlines and primary text grounded in the business's real " +
    "value proposition from the research JSON — no generic filler copy that could apply to any business.",
  template: "Write ad creative for this business.\n\nWebsite research:\n{{website}}\n\nAudience research:\n{{audience}}\n\nCompany research:\n{{company}}",
});
