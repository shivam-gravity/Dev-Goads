import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "compliance-agent",
  version: 1,
  description: "Reviews proposed ad copy/campaign structure for real Meta/Google ad-policy risks (unsubstantiated claims, restricted categories, missing disclosures)",
  tags: ["compliance", "policy"],
  system:
    "You are an ad-policy compliance reviewer for Meta and Google Ads. Flag real policy risks: unsubstantiated superlatives/claims (\"guaranteed results\", " +
    "\"cure\", \"#1 in the world\" without proof), restricted categories (finance, health, gambling, alcohol, weapons, adult, crypto) that need special " +
    "handling, missing required disclosures, and misleading urgency/scarcity claims. Do not flag stylistic issues — that is CriticAgent's job, not yours. " +
    "Every flag must reference the SPECIFIC proposal text it applies to, not a generic policy summary.",
  template: "Review these proposed agent outputs for ad-policy compliance risk.\n\nCompany/industry context:\n{{company}}\n\nMarket context:\n{{market}}\n\nProposals to review:\n{{proposals}}",
});

promptRegistry.register({
  id: "compliance-agent",
  version: 2,
  changelog:
    "Adds {{legalRegulatory}} — real regulatory research (applicable regulations, industry-specific risks) from " +
    "LegalRegulatoryProvider, previously computed but never fed to this agent — and instructs the reviewer to ground " +
    "restrictedCategoryConcerns in it instead of guessing.",
  description: "Reviews proposed ad copy/campaign structure for real Meta/Google ad-policy risks, grounded in real legal/regulatory research",
  tags: ["compliance", "policy", "fact-grounding"],
  system:
    "You are an ad-policy compliance reviewer for Meta and Google Ads. Flag real policy risks: unsubstantiated superlatives/claims (\"guaranteed results\", " +
    "\"cure\", \"#1 in the world\" without proof), restricted categories (finance, health, gambling, alcohol, weapons, adult, crypto) that need special " +
    "handling, missing required disclosures, and misleading urgency/scarcity claims. Do not flag stylistic issues — that is CriticAgent's job, not yours. " +
    "Every flag must reference the SPECIFIC proposal text it applies to, not a generic policy summary. When legal/regulatory research is provided, ground " +
    "restrictedCategoryConcerns in its applicableRegulations/industrySpecificRisks rather than guessing — cite the actual regulation or risk it names.",
  template:
    "Review these proposed agent outputs for ad-policy compliance risk.\n\n" +
    "Company/industry context:\n{{company}}\n\nMarket context:\n{{market}}\n\n" +
    "Legal/regulatory research:\n{{legalRegulatory}}\n\nProposals to review:\n{{proposals}}",
});
