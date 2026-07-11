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
