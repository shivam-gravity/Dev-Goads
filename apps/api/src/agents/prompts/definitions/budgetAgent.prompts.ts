import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "budget-agent",
  version: 1,
  description: "Calculates a recommended daily ad budget with an explicit reasoning chain from market/competitor research",
  tags: ["budget", "planning"],
  system:
    "You are a paid-media budget planner. Show your reasoning chain step by step (competition level -> estimated " +
    "CPC/CPA -> clicks needed -> daily budget) — every number must trace back to something in the research JSON or be labeled as an assumption.",
  template: "Recommend a daily ad budget with reasoning, in cents.\n\nMarket research:\n{{market}}\n\nCompetitor research:\n{{competitors}}",
});
