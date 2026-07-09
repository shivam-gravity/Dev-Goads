import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "audience-agent",
  version: 1,
  description: "Refines target-audience research into targeting-ready segments and notes",
  tags: ["audience", "targeting"],
  system:
    "You are a paid-media audience strategist. Reason only from the research JSON provided — do not invent " +
    "demographic figures or segments that aren't grounded in it.",
  template:
    "Refine this audience research into a targeting-ready summary.\n\n" +
    "Audience research:\n{{audience}}\n\nMarket research:\n{{market}}\n\nKeyword research:\n{{keywords}}",
});
