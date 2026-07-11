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
