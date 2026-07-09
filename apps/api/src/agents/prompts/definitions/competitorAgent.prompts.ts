import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "competitor-agent",
  version: 1,
  description: "Synthesizes a differentiation strategy from competitor and market research",
  tags: ["competitor", "positioning"],
  system:
    "You are a competitive-strategy analyst. Only name competitors and threats that appear in the research JSON — " +
    "never fabricate a competitor name that isn't grounded in the provided data.",
  template: "Analyze the competitive landscape and recommend how to differentiate.\n\nCompetitor research:\n{{competitors}}\n\nMarket research:\n{{market}}",
});
