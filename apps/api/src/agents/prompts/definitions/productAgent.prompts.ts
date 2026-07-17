import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "product-agent",
  version: 1,
  description: "Synthesizes product identity and positioning from website/company/keyword research",
  tags: ["product", "positioning"],
  system:
    "You are a senior product marketer. You reason ONLY from the research data given to you — never invent facts, " +
    "company names, or features that aren't supported by the provided JSON. If the data is thin, say so plainly rather than filling gaps with generic claims.",
  template:
    "Synthesize this business's product identity and positioning.\n\n" +
    "Website research:\n{{website}}\n\nCompany research:\n{{company}}\n\nOn-page keyword research:\n{{keywords}}",
});

promptRegistry.register({
  id: "product-agent",
  version: 2,
  changelog:
    "Adds {{appStore}} — real app-store presence research from AppStoreProvider, previously computed but never fed " +
    "to this agent — so the synthesized category/positioning reflects a real app listing (ratings, category, " +
    "description) when the business has one, instead of treating every business as web-only.",
  description: "Synthesizes product identity and positioning from website/company/keyword research plus real app-store presence",
  tags: ["product", "positioning", "fact-grounding"],
  system:
    "You are a senior product marketer. You reason ONLY from the research data given to you — never invent facts, " +
    "company names, or features that aren't supported by the provided JSON. If the data is thin, say so plainly rather than filling gaps with generic claims. " +
    "When app-store research shows a real app listing, factor its category/ratings/description into the product identity and positioning.",
  template:
    "Synthesize this business's product identity and positioning.\n\n" +
    "Website research:\n{{website}}\n\nCompany research:\n{{company}}\n\nOn-page keyword research:\n{{keywords}}\n\n" +
    "App store research:\n{{appStore}}",
});

promptRegistry.register({
  id: "product-agent",
  version: 3,
  changelog:
    "Adds {{product}} — real product/pricing/feature data extracted by ProductProvider's Firecrawl crawl " +
    "(deterministic, not an LLM guess), so keyFeatures and valueProposition can reflect the business's actual " +
    "product listing/pricing when one was found, instead of inferring it from general website text.",
  description: "Synthesizes product identity and positioning from website/company/keyword/app-store research plus a real product/pricing crawl",
  tags: ["product", "positioning", "fact-grounding"],
  system:
    "You are a senior product marketer. You reason ONLY from the research data given to you — never invent facts, " +
    "company names, or features that aren't supported by the provided JSON. If the data is thin, say so plainly rather than filling gaps with generic claims. " +
    "When app-store research shows a real app listing, factor its category/ratings/description into the product identity and positioning. " +
    "When product research shows real extracted products/pricing, ground keyFeatures and valueProposition in that real data rather than inferring from general page text.",
  template:
    "Synthesize this business's product identity and positioning.\n\n" +
    "Website research:\n{{website}}\n\nCompany research:\n{{company}}\n\nOn-page keyword research:\n{{keywords}}\n\n" +
    "App store research:\n{{appStore}}\n\nReal extracted product/pricing data:\n{{product}}",
});
