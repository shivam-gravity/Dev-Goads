import { test } from "node:test";
import assert from "node:assert";
import { TtlCache, normalizeCacheKey } from "../research/cache/TtlCache.js";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("TtlCache - returns a stored value before it expires", () => {
  const cache = new TtlCache<string>(10_000);
  cache.set("key", "value");
  assert.strictEqual(cache.get("key"), "value");
  assert.strictEqual(cache.has("key"), true);
});

test("TtlCache - returns null for a missing key", () => {
  const cache = new TtlCache<string>(10_000);
  assert.strictEqual(cache.get("missing"), null);
  assert.strictEqual(cache.has("missing"), false);
});

test("TtlCache - expires entries after the TTL elapses", async () => {
  const cache = new TtlCache<string>(20);
  cache.set("key", "value");
  assert.strictEqual(cache.get("key"), "value");
  await delay(40);
  assert.strictEqual(cache.get("key"), null, "entry should have expired");
  assert.strictEqual(cache.size, 0, "expired entry should be evicted on read");
});

test("TtlCache - delete and clear remove entries", () => {
  const cache = new TtlCache<string>(10_000);
  cache.set("a", "1");
  cache.set("b", "2");
  cache.delete("a");
  assert.strictEqual(cache.get("a"), null);
  assert.strictEqual(cache.get("b"), "2");
  cache.clear();
  assert.strictEqual(cache.size, 0);
});

test("normalizeCacheKey - treats casing, trailing slashes as equivalent", () => {
  assert.strictEqual(normalizeCacheKey("Example.com"), normalizeCacheKey("example.com/"));
  assert.strictEqual(normalizeCacheKey("https://Example.com/"), normalizeCacheKey("https://example.com"));
});
