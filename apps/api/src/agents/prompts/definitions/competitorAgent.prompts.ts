import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "competitor-agent",
  version: 1,
  description: "Synthesizes a differentiation strategy from competitor and market research",
  tags: ["competitor", "positioning"],
  system:
    "You are a competitive-strategy analyst. Only name competitors and threats that appear in the research JSON — " +
    "never fabricate a competitor name that isn't grounded in the provided data.",
  template: "Analyze the competitive landscape and recommend how to differentiate.\n\nCompetitor research:\n{{competitors}}\n\nMarket research:\n{{market}}",
});

promptRegistry.register({
  id: "competitor-agent",
  version: 2,
  changelog:
    "Adds {{partnerships}} — real integration/partnership-ecosystem research from PartnershipProvider, previously " +
    "computed but never fed to this agent — a richer partner ecosystem is a real competitive advantage and threat " +
    "signal worth naming explicitly.",
  description: "Synthesizes a differentiation strategy from competitor/market research and real partnership-ecosystem research",
  tags: ["competitor", "positioning", "fact-grounding"],
  system:
    "You are a competitive-strategy analyst. Only name competitors and threats that appear in the research JSON — " +
    "never fabricate a competitor name that isn't grounded in the provided data. When partnership research is provided, weigh a strong integration/" +
    "partner ecosystem as a real competitive advantage, and a competitor's stronger ecosystem as a real threat.",
  template:
    "Analyze the competitive landscape and recommend how to differentiate.\n\n" +
    "Competitor research:\n{{competitors}}\n\nMarket research:\n{{market}}\n\nPartnership/ecosystem research:\n{{partnerships}}",
});

promptRegistry.register({
  id: "competitor-agent",
  version: 3,
  changelog:
    "Adds {{adLibrary}} — real competitor ad activity (Meta Ad Library API + Google Ads Transparency Center) from " +
    "AdLibraryProvider, so threats/positioning can reflect what competitors are actually spending on and messaging " +
    "with right now, not just their product/market positioning.",
  description: "Synthesizes a differentiation strategy from competitor/market/partnership research and real competitor ad activity",
  tags: ["competitor", "positioning", "fact-grounding"],
  system:
    "You are a competitive-strategy analyst. Only name competitors and threats that appear in the research JSON — " +
    "never fabricate a competitor name that isn't grounded in the provided data. When partnership research is provided, weigh a strong integration/" +
    "partner ecosystem as a real competitive advantage, and a competitor's stronger ecosystem as a real threat. " +
    "When real ad library data is provided, treat active/heavy competitor ad spend on a given angle as a threat signal worth naming.",
  template:
    "Analyze the competitive landscape and recommend how to differentiate.\n\n" +
    "Competitor research:\n{{competitors}}\n\nMarket research:\n{{market}}\n\nPartnership/ecosystem research:\n{{partnerships}}\n\n" +
    "Real competitor ad activity (Ad Library):\n{{adLibrary}}",
});
