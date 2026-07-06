import { test } from "node:test";
import assert from "node:assert";
import { buildMetaTargetingSpec, estimateReachHeuristic, fetchMetaReachEstimate } from "../modules/adapters/metaTargetingMapper.js";
import type { SavedAudience } from "../modules/audience/savedAudienceService.js";

const baseAudience: SavedAudience = {
  id: "aud-1",
  workspaceId: "ws-1",
  name: "Test Audience",
  ageMin: 25,
  ageMax: 45,
  gender: "female",
  locations: ["US", "CA"],
  interests: ["Marketing"],
  exclusions: [],
  createdAt: new Date().toISOString(),
};

test("metaTargetingMapper - estimateReachHeuristic returns a labeled, bounded estimate", () => {
  const estimate = estimateReachHeuristic(baseAudience);
  assert.strictEqual(estimate.source, "heuristic");
  assert.ok(estimate.usersLowerBound < estimate.usersUpperBound);
  assert.ok(estimate.usersLowerBound > 0);
});

test("metaTargetingMapper - buildMetaTargetingSpec resolves interests and maps demographics", async () => {
  const original = global.fetch;
  global.fetch = (async (url: string) => {
    assert.ok(String(url).includes("/search?"));
    return { ok: true, json: async () => ({ data: [{ id: "6003107902433", name: "Marketing" }] }) } as Response;
  }) as typeof fetch;

  try {
    const spec = await buildMetaTargetingSpec("test-token", baseAudience);
    assert.strictEqual(spec.age_min, 25);
    assert.strictEqual(spec.age_max, 45);
    assert.deepStrictEqual(spec.genders, [2]);
    assert.deepStrictEqual(spec.geo_locations.countries, ["US", "CA"]);
    assert.strictEqual(spec.flexible_spec?.[0]?.interests[0]?.id, "6003107902433");
  } finally {
    global.fetch = original;
  }
});

test("metaTargetingMapper - buildMetaTargetingSpec drops interests with no match instead of failing", async () => {
  const original = global.fetch;
  global.fetch = (async () => ({ ok: true, json: async () => ({ data: [] }) })) as unknown as typeof fetch;

  try {
    const spec = await buildMetaTargetingSpec("test-token", baseAudience);
    assert.strictEqual(spec.flexible_spec, undefined);
  } finally {
    global.fetch = original;
  }
});

test("metaTargetingMapper - fetchMetaReachEstimate parses Meta's delivery_estimate response", async () => {
  const original = global.fetch;
  global.fetch = (async (url: string) => {
    assert.ok(String(url).includes("/act_123/delivery_estimate"));
    return { ok: true, json: async () => ({ data: [{ estimate_mau_lower_bound: 100000, estimate_mau_upper_bound: 200000 }] }) } as Response;
  }) as typeof fetch;

  try {
    const estimate = await fetchMetaReachEstimate("test-token", "123", {
      age_min: 25, age_max: 45, geo_locations: { countries: ["US"] },
    });
    assert.deepStrictEqual(estimate, { usersLowerBound: 100000, usersUpperBound: 200000, source: "meta" });
  } finally {
    global.fetch = original;
  }
});
