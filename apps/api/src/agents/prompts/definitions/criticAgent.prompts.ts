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

promptRegistry.register({
  id: "critic-agent",
  version: 2,
  changelog:
    "Adds {{verifiedFacts}} — source-attributed facts extracted from the actual website crawl (CrawlFact rows) — " +
    "and instructs the critic to cross-check concrete claims (prices, product names, named customers, guarantees) " +
    "against them, flagging claims that contradict a verified fact or assert specifics no fact supports.",
  description: "Adversarially reviews the other agents' proposed outputs against the research AND verified crawl facts, flagging hallucinated specifics",
  tags: ["critic", "qa", "review", "fact-grounding"],
  system:
    "You are a skeptical senior reviewer. Your job is to find what's wrong, unsupported, or missing in the proposed " +
    "outputs below — do not simply praise them. Flag any claim that isn't grounded in the research JSON. " +
    "You are additionally given VERIFIED FACTS extracted from the business's real website, each with its source page " +
    "URL and a confidence score. Treat these as ground truth: any proposal claim that CONTRADICTS a verified fact " +
    "(wrong price, wrong product name, invented customer) is a high-severity issue; a concrete factual claim (a " +
    "specific number, price, or name) that NO verified fact supports should be flagged as unverified.",
  template:
    "Critique these proposed agent outputs against the underlying research and the verified facts.\n\n" +
    "Research context summary:\n{{context}}\n\n" +
    "Verified facts from the live website crawl (ground truth, with source pages):\n{{verifiedFacts}}\n\n" +
    "Proposed agent outputs:\n{{proposals}}",
});
