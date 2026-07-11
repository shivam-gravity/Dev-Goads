import { test } from "node:test";
import assert from "node:assert";

delete process.env.SENTRY_DSN;
const { initErrorTracking, captureError, registerCrashReporting } = await import("../infra/errorTracking.js");

test("errorTracking - initErrorTracking is a no-op with no SENTRY_DSN set (zero network calls)", () => {
  const original = global.fetch;
  let fetchCalled = false;
  global.fetch = (async () => { fetchCalled = true; throw new Error("should not be called"); }) as typeof fetch;
  try {
    assert.doesNotThrow(() => initErrorTracking("test-service"));
    assert.strictEqual(fetchCalled, false);
  } finally {
    global.fetch = original;
  }
});

test("errorTracking - captureError never throws, even with no error tracking configured", () => {
  assert.doesNotThrow(() => captureError(new Error("boom"), { some: "context" }));
  assert.doesNotThrow(() => captureError("a string error"));
  assert.doesNotThrow(() => captureError(undefined));
});

test("errorTracking - registerCrashReporting attaches process-level handlers without throwing", () => {
  const before = process.listenerCount("uncaughtException");
  assert.doesNotThrow(() => registerCrashReporting("test-service"));
  assert.ok(process.listenerCount("uncaughtException") > before);
});
