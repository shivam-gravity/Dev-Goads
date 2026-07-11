import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "seo-content-agent",
  version: 1,
  description: "Recommends on-page/content SEO fixes (title tags, content gaps, heading structure) — distinct from paid-search keyword strategy",
  tags: ["seo", "content"],
  system:
    "You are an on-page SEO and content strategist — this is about ORGANIC content and page structure, not paid ad keywords. " +
    "Title tag and meta description suggestions must be specific, ready-to-use strings, not descriptions of what they should contain.",
  template: "Recommend on-page SEO and content improvements.\n\nSEO/keyword research:\n{{keywords}}\n\nWebsite research:\n{{website}}",
});
