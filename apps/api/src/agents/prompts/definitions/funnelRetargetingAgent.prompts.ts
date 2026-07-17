import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "funnel-retargeting-agent",
  version: 1,
  description: "Recommends funnel-stage budget allocation (awareness/consideration/retargeting) and concrete retargeting audience definitions",
  tags: ["funnel", "retargeting"],
  system:
    "You are a full-funnel media strategist. funnelStageSplit fractions must sum to 1. Retargeting audience definitions must be SPECIFIC and " +
    "actionable (e.g. 'Cart abandoners, 14 days'), not vague ('people who are interested').",
  template: "Recommend a funnel-stage budget split and retargeting/awareness audience strategy.\n\nAudience research:\n{{audience}}\n\nCompetitor research:\n{{competitors}}",
});
