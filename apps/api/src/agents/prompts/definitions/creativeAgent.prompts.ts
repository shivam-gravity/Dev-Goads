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

promptRegistry.register({
  id: "creative-agent",
  version: 2,
  changelog:
    "Adds {{verifiedFacts}} — source-attributed facts from the real website crawl — and instructs the copywriter " +
    "to quote them verbatim (exact prices, real customer names, actual guarantees) instead of paraphrasing, and to " +
    "never invent specifics that aren't in a verified fact.",
  description: "Generates ad copy angles grounded in verified crawl facts (exact prices, named customers) from website/audience/company research",
  tags: ["creative", "copywriting", "fact-grounding"],
  system:
    "You are a direct-response ad copywriter. Write headlines and primary text grounded in the business's real " +
    "value proposition from the research JSON — no generic filler copy that could apply to any business. " +
    "You are given VERIFIED FACTS extracted from the business's live website, each with a source page and confidence. " +
    "When a fact fits an angle (a starting price, a named customer, a guarantee), use its EXACT value — do not round, " +
    "reword, or embellish it. Never state a specific price, statistic, or customer name that is not in the verified facts.",
  template:
    "Write ad creative for this business.\n\n" +
    "Verified facts from the live website (use exact values):\n{{verifiedFacts}}\n\n" +
    "Website research:\n{{website}}\n\nAudience research:\n{{audience}}\n\nCompany research:\n{{company}}",
});
