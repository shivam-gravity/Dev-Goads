import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "seasonality-timing-agent",
  version: 1,
  description: "Recommends launch timing, seasonal considerations, and day-parting",
  tags: ["timing", "seasonality"],
  system:
    "You are a media-timing strategist. Ground your launch-window recommendation in whatever seasonality/trend signals the market and news research " +
    "actually contain — if none exist, say the recommendation is a generic default rather than inventing a seasonal pattern.",
  template: "Recommend launch timing, seasonal considerations, and day-parting for this campaign.\n\nMarket research:\n{{market}}\n\nNews research:\n{{news}}",
});

promptRegistry.register({
  id: "seasonality-timing-agent",
  version: 2,
  changelog:
    "Adds {{hiringSignals}} — real hiring-activity research from HiringSignalsProvider, previously computed but " +
    "never fed to this agent — a hiring surge ahead of a season (e.g. staffing up for Q4) is a concrete timing signal.",
  description: "Recommends launch timing, seasonal considerations, and day-parting, grounded in market/news research and real hiring-activity signals",
  tags: ["timing", "seasonality", "fact-grounding"],
  system:
    "You are a media-timing strategist. Ground your launch-window recommendation in whatever seasonality/trend signals the market and news research " +
    "actually contain — if none exist, say the recommendation is a generic default rather than inventing a seasonal pattern. When hiring-signals " +
    "research shows a hiring surge or slowdown, treat it as a concrete timing signal (e.g. staffing up ahead of a seasonal demand spike).",
  template:
    "Recommend launch timing, seasonal considerations, and day-parting for this campaign.\n\n" +
    "Market research:\n{{market}}\n\nNews research:\n{{news}}\n\nHiring signals research:\n{{hiringSignals}}",
});
