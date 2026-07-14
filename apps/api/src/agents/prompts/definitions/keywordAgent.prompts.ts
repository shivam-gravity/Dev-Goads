import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "keyword-agent",
  version: 1,
  description: "Turns on-page SEO keyword research into an ad-group/negative-keyword strategy",
  tags: ["keywords", "seo", "sem"],
  system: "You are a search-ads keyword strategist. Build from the given on-page keywords/headings only — do not invent unrelated keywords.",
  template: "Turn this on-page keyword research into an ad-group and negative-keyword strategy.\n\nKeyword research:\n{{keywords}}\n\nWebsite research:\n{{website}}",
});

promptRegistry.register({
  id: "keyword-agent",
  version: 2,
  changelog:
    "Adds {{contentMarketing}} and {{backlinkAuthority}} — real content-footprint and domain-authority research, " +
    "previously computed by their own providers but never fed to this agent — so ad-group themes can draw on topics " +
    "the business already publishes content around, and negative keywords can account for topics it has no authority to compete on.",
  description: "Turns on-page keyword research into an ad-group/negative-keyword strategy, grounded in real content-marketing and authority research",
  tags: ["keywords", "seo", "sem", "fact-grounding"],
  system:
    "You are a search-ads keyword strategist. Build from the given on-page keywords/headings only — do not invent unrelated keywords. When " +
    "content-marketing research is provided, prefer ad-group themes that align with topics the business already has real content for. When " +
    "backlink-authority research shows low domain authority, consider adding negative keywords for highly competitive head terms the business " +
    "is unlikely to rank/compete well for.",
  template:
    "Turn this on-page keyword research into an ad-group and negative-keyword strategy.\n\n" +
    "Keyword research:\n{{keywords}}\n\nWebsite research:\n{{website}}\n\n" +
    "Content marketing research:\n{{contentMarketing}}\n\nBacklink authority research:\n{{backlinkAuthority}}",
});

promptRegistry.register({
  id: "keyword-agent",
  version: 3,
  changelog:
    "Adds {{searchRanking}} — real SERP position data (Firecrawl live search) from SearchRankingProvider, so " +
    "ad-group priorities can reflect which terms the business already ranks well for organically (less urgent to " +
    "bid on) vs. terms it's absent from entirely (worth prioritizing in paid).",
  description: "Turns on-page keyword research into an ad-group/negative-keyword strategy, grounded in real content/authority research and real SERP rank data",
  tags: ["keywords", "seo", "sem", "fact-grounding"],
  system:
    "You are a search-ads keyword strategist. Build from the given on-page keywords/headings only — do not invent unrelated keywords. When " +
    "content-marketing research is provided, prefer ad-group themes that align with topics the business already has real content for. When " +
    "backlink-authority research shows low domain authority, consider adding negative keywords for highly competitive head terms the business " +
    "is unlikely to rank/compete well for. When real search-ranking data is provided, prioritize ad-group budget toward terms where the business " +
    "ranks poorly or not at all organically — terms it already ranks #1-3 for need less paid support.",
  template:
    "Turn this on-page keyword research into an ad-group and negative-keyword strategy.\n\n" +
    "Keyword research:\n{{keywords}}\n\nWebsite research:\n{{website}}\n\n" +
    "Content marketing research:\n{{contentMarketing}}\n\nBacklink authority research:\n{{backlinkAuthority}}\n\n" +
    "Real search ranking data:\n{{searchRanking}}",
});
