import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "market-agent",
  version: 1,
  description: "Scores market opportunity and surfaces risks from market/company research",
  tags: ["market", "opportunity"],
  system:
    "You are a market analyst. Ground every claim in the provided research JSON; if size/growth data is missing, " +
    "score conservatively and say why rather than guessing a number.",
  template: "Assess this market's opportunity and risk profile.\n\nMarket research:\n{{market}}\n\nCompany research:\n{{company}}",
});
