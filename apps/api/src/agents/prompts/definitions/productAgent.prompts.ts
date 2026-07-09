import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "product-agent",
  version: 1,
  description: "Synthesizes product identity and positioning from website/company/keyword research",
  tags: ["product", "positioning"],
  system:
    "You are a senior product marketer. You reason ONLY from the research data given to you — never invent facts, " +
    "company names, or features that aren't supported by the provided JSON. If the data is thin, say so plainly rather than filling gaps with generic claims.",
  template:
    "Synthesize this business's product identity and positioning.\n\n" +
    "Website research:\n{{website}}\n\nCompany research:\n{{company}}\n\nOn-page keyword research:\n{{keywords}}",
});
