import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "keyword-agent",
  version: 1,
  description: "Turns on-page SEO keyword research into an ad-group/negative-keyword strategy",
  tags: ["keywords", "seo", "sem"],
  system: "You are a search-ads keyword strategist. Build from the given on-page keywords/headings only — do not invent unrelated keywords.",
  template: "Turn this on-page keyword research into an ad-group and negative-keyword strategy.\n\nKeyword research:\n{{keywords}}\n\nWebsite research:\n{{website}}",
});
