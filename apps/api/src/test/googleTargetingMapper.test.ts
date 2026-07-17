import { test } from "node:test";
import assert from "node:assert";
import { buildGoogleTargeting, withAgentKeywords } from "../modules/adapters/googleTargetingMapper.js";
import type { SavedAudience } from "../modules/audience/savedAudienceService.js";

const baseAudience: SavedAudience = {
  id: "aud-1",
  workspaceId: "ws-1",
  name: "Test Audience",
  ageMin: 25,
  ageMax: 45,
  gender: "female",
  locations: ["United States"],
  interests: ["running shoes"],
  exclusions: [],
  createdAt: new Date().toISOString(),
};

test("googleTargetingMapper - buildGoogleTargeting maps demographics via static geo table when offline", async () => {
  const targeting = await buildGoogleTargeting(null, null, baseAudience);
  assert.deepStrictEqual(targeting.campaign.geoTargetConstants, ["geoTargetConstants/2840"]);
  assert.strictEqual(targeting.campaign.languageConstant, "languageConstants/1000");
  assert.deepStrictEqual(targeting.adGroup.ageRanges, ["AGE_RANGE_25_34", "AGE_RANGE_35_44", "AGE_RANGE_45_54"]);
  assert.deepStrictEqual(targeting.adGroup.genders, ["FEMALE"]);
  assert.deepStrictEqual(targeting.adGroup.keywords, ["running shoes"]);
});

test("googleTargetingMapper - buildGoogleTargeting covers a wide age span with multiple buckets", async () => {
  const targeting = await buildGoogleTargeting(null, null, { ...baseAudience, ageMin: 18, ageMax: 65, gender: "all" });
  assert.deepStrictEqual(targeting.adGroup.ageRanges, [
    "AGE_RANGE_18_24", "AGE_RANGE_25_34", "AGE_RANGE_35_44", "AGE_RANGE_45_54", "AGE_RANGE_55_64", "AGE_RANGE_65_UP",
  ]);
  assert.deepStrictEqual(targeting.adGroup.genders, ["MALE", "FEMALE", "UNDETERMINED"]);
});

test("googleTargetingMapper - buildGoogleTargeting falls back to the default geo id for an unrecognized location", async () => {
  const targeting = await buildGoogleTargeting(null, null, { ...baseAudience, locations: ["Neverland"] });
  assert.deepStrictEqual(targeting.campaign.geoTargetConstants, ["geoTargetConstants/2840"]);
});

test("googleTargetingMapper - withAgentKeywords merges agent primary keywords with the audience's, de-duped case-insensitively (merge, not replace)", () => {
  const adGroup = { ageRanges: ["AGE_RANGE_25_34"], genders: ["FEMALE"], keywords: ["running shoes", "trail shoes"] };
  const merged = withAgentKeywords(adGroup, { primary: ["Running Shoes", "marathon gear"], negative: [] });
  // audience keywords kept (original casing wins), agent duplicate "Running Shoes" dropped, new one appended
  assert.deepStrictEqual(merged.keywords, ["running shoes", "trail shoes", "marathon gear"]);
});

test("googleTargetingMapper - withAgentKeywords sets negative keywords (de-duped, trimmed) without touching positives", () => {
  const adGroup = { ageRanges: [], genders: [], keywords: ["a"] };
  const merged = withAgentKeywords(adGroup, { primary: [], negative: ["free", "Free", " cheap "] });
  assert.deepStrictEqual(merged.negativeKeywords, ["free", "cheap"]);
  assert.deepStrictEqual(merged.keywords, ["a"], "negatives must not alter the positive keyword list");
});

test("googleTargetingMapper - withAgentKeywords is a no-op (same reference, no negativeKeywords field) when no agent keywords are supplied", () => {
  const adGroup = { ageRanges: ["AGE_RANGE_18_24"], genders: ["MALE"], keywords: ["x"] };
  const result = withAgentKeywords(adGroup, undefined);
  assert.strictEqual(result, adGroup, "must return the same object reference — byte-identical to the audience-only path");
  assert.strictEqual(result.negativeKeywords, undefined, "no negativeKeywords field is introduced on the no-op path");
});
