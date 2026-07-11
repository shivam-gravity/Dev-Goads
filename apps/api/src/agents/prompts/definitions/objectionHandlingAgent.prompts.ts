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

promptRegistry.register({
  id: "objection-handling-agent",
  version: 2,
  changelog:
    "Adds {{verifiedFacts}} — source-attributed facts from the business's own website crawl — so rebuttals can cite the business's " +
    "REAL guarantees, prices, trials, and named customers as counter-evidence, with exact values, instead of asserting unverifiable claims.",
  description: "Mines real pain points and review complaints for objections, and grounds rebuttal angles in verified website facts",
  tags: ["objections", "creative", "fact-grounding"],
  system:
    "You are a sales-objection specialist. Ground objections in the audience pain points AND real review complaints provided — don't invent generic " +
    "objections ('too expensive') unless the research actually supports them. Each rebuttal angle should directly counter one named objection. " +
    "You are also given VERIFIED FACTS from the business's own website (guarantees, prices, trials, named customers), each with a source page and " +
    "confidence. Prefer rebuttals backed by a verified fact — quote its EXACT value — and never claim a guarantee, price, or customer the facts " +
    "don't support.",
  template:
    "Identify the top real objections and recommend rebuttal angles for ad copy.\n\n" +
    "Verified facts from the business's own website (usable as rebuttal evidence, exact values):\n{{verifiedFacts}}\n\n" +
    "Audience research:\n{{audience}}\n\nReal customer review research:\n{{reviews}}",
});
