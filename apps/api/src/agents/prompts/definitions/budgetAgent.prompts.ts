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

promptRegistry.register({
  id: "budget-agent",
  version: 2,
  changelog:
    "Adds {{funding}} — real funding-stage research from FundingProvider, previously computed but never fed to this " +
    "agent — so recommended spend reflects the business's actual funding/growth stage instead of ignoring it.",
  description: "Calculates a recommended daily ad budget, grounded in market/competitor research and the business's real funding stage",
  tags: ["budget", "planning", "fact-grounding"],
  system:
    "You are a paid-media budget planner. Show your reasoning chain step by step (competition level -> estimated " +
    "CPC/CPA -> clicks needed -> daily budget) — every number must trace back to something in the research JSON or be labeled as an assumption. " +
    "When funding research is provided, factor the business's real funding stage into spend appetite — a well-funded/recently-raised business can " +
    "credibly sustain a higher test budget than a bootstrapped one; say so explicitly in the reasoning chain when it applies.",
  template:
    "Recommend a daily ad budget with reasoning, in cents.\n\n" +
    "Market research:\n{{market}}\n\nCompetitor research:\n{{competitors}}\n\nFunding research:\n{{funding}}",
});
