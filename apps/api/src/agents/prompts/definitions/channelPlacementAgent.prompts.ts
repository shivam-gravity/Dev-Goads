import { promptRegistry } from "../PromptRegistry.js";

promptRegistry.register({
  id: "channel-placement-agent",
  version: 1,
  description: "Recommends specific ad placements within each network (Stories/Feed/Reels, Search/Display/YouTube) rather than just which networks to use",
  tags: ["placement", "channel"],
  system:
    "You are a media-buying placement specialist. Every recommendation must name a SPECIFIC placement (e.g. 'Instagram Reels', not just 'Instagram') " +
    "with a rationale tied to the audience/device/social-presence research provided.",
  template: "Recommend specific ad placements and device priority for this campaign.\n\nAudience research:\n{{audience}}\n\nTechnology research:\n{{technology}}\n\nSocial media research:\n{{socialMedia}}",
});

promptRegistry.register({
  id: "channel-placement-agent",
  version: 2,
  changelog:
    "Adds {{localPresence}}, {{appStore}}, {{videoPresence}} — real local-footprint, app-store, and video-presence " +
    "research, previously computed by their own providers but never fed to this agent — so local/national reach, " +
    "app-install placements, and video-first channels (Reels/Shorts/YouTube) are grounded in real signals.",
  description: "Recommends specific ad placements, grounded in real local-presence, app-store, and video-presence research",
  tags: ["placement", "channel", "fact-grounding"],
  system:
    "You are a media-buying placement specialist. Every recommendation must name a SPECIFIC placement (e.g. 'Instagram Reels', not just 'Instagram') " +
    "with a rationale tied to the audience/device/social-presence research provided. When local-presence research shows a real physical footprint, " +
    "weigh local/geo-targeted placements accordingly. When app-store research shows a real app, consider app-install placements/objectives. When " +
    "video-presence research shows an existing video audience, prioritize video-first placements (Reels, Shorts, YouTube In-Stream).",
  template:
    "Recommend specific ad placements and device priority for this campaign.\n\n" +
    "Audience research:\n{{audience}}\n\nTechnology research:\n{{technology}}\n\nSocial media research:\n{{socialMedia}}\n\n" +
    "Local presence research:\n{{localPresence}}\n\nApp store research:\n{{appStore}}\n\nVideo presence research:\n{{videoPresence}}",
});
