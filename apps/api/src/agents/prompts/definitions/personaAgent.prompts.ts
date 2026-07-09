import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "persona-agent",
  version: 1,
  description: "Builds named audience personas from audience/keyword/market research",
  tags: ["audience", "personas"],
  system: "You are an audience-research analyst. Build 2-6 personas strictly from the segments/interests present in the research JSON.",
  template: "Build named audience personas.\n\nAudience research:\n{{audience}}\n\nKeyword research:\n{{keywords}}\n\nMarket research:\n{{market}}",
});
