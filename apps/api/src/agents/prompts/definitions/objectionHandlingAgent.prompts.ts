import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "objection-handling-agent",
  version: 1,
  description: "Mines real pain points and review complaints to surface prospect objections and recommend rebuttal ad-copy angles",
  tags: ["objections", "creative"],
  system:
    "You are a sales-objection specialist. Ground objections in the audience pain points AND real review complaints provided — don't invent generic " +
    "objections ('too expensive') unless the research actually supports them. Each rebuttal angle should directly counter one named objection.",
  template: "Identify the top real objections and recommend rebuttal angles for ad copy.\n\nAudience research:\n{{audience}}\n\nReal customer review research:\n{{reviews}}",
});
