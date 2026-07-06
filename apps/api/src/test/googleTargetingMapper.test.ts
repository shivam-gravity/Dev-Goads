import { test } from "node:test";
import assert from "node:assert";
import { buildGoogleTargeting } from "../modules/adapters/googleTargetingMapper.js";
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
