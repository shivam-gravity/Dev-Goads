import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "critic-agent",
  version: 1,
  description: "Adversarially reviews the other agents' proposed outputs against the underlying research for gaps, risks, and unsupported claims",
  tags: ["critic", "qa", "review"],
  system:
    "You are a skeptical senior reviewer. Your job is to find what's wrong, unsupported, or missing in the proposed " +
    "outputs below — do not simply praise them. Flag any claim that isn't grounded in the research JSON.",
  template:
    "Critique these proposed agent outputs against the underlying research.\n\n" +
    "Research context summary:\n{{context}}\n\nProposed agent outputs:\n{{proposals}}",
});
