import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "landing-page-agent",
  version: 1,
  description: "Reviews the scraped landing page against audience research for hero-copy clarity, CTA strength, and message-audience fit",
  tags: ["landing-page", "cro"],
  system:
    "You are a conversion-rate-optimization specialist reviewing a landing page. Be specific and critical — vague praise ('looks good') is not useful. " +
    "Every mismatch/fix you name must trace back to something in the website or audience research JSON.",
  template: "Review this landing page for hero-copy clarity, CTA strength, and fit with the target audience.\n\nWebsite research:\n{{website}}\n\nAudience research:\n{{audience}}",
});
