import { test } from "node:test";
import assert from "node:assert";
import { freshnessScore, isStale } from "../research/knowledge/freshness.js";

const DAY_MS = 24 * 60 * 60 * 1000;

test("freshnessScore - a just-captured timestamp scores 1", () => {
  assert.strictEqual(freshnessScore(new Date().toISOString(), 10 * DAY_MS), 1);
});

test("freshnessScore - a future timestamp still scores 1 (never > 1)", () => {
  assert.strictEqual(freshnessScore(new Date(Date.now() + DAY_MS).toISOString(), 10 * DAY_MS), 1);
});

test("freshnessScore - decays linearly toward 0 as age approaches the TTL", () => {
  const halfway = new Date(Date.now() - 5 * DAY_MS).toISOString();
  assert.strictEqual(freshnessScore(halfway, 10 * DAY_MS), 0.5);
});

test("freshnessScore - floors at 0 once age reaches or exceeds the TTL", () => {
  const atTtl = new Date(Date.now() - 10 * DAY_MS).toISOString();
  const pastTtl = new Date(Date.now() - 20 * DAY_MS).toISOString();
  assert.strictEqual(freshnessScore(atTtl, 10 * DAY_MS), 0);
  assert.strictEqual(freshnessScore(pastTtl, 10 * DAY_MS), 0);
});

test("isStale - true once freshnessScore reaches 0, false while still decaying", () => {
  const halfway = new Date(Date.now() - 5 * DAY_MS).toISOString();
  const pastTtl = new Date(Date.now() - 20 * DAY_MS).toISOString();
  assert.strictEqual(isStale(halfway, 10 * DAY_MS), false);
  assert.strictEqual(isStale(pastTtl, 10 * DAY_MS), true);
});
