import { test } from "node:test";
import assert from "node:assert";
import { withSpan } from "../infra/telemetry.js";

test("withSpan - returns fn's resolved value", async () => {
  const result = await withSpan("test.span", async () => "hello");
  assert.strictEqual(result, "hello");
});

test("withSpan - propagates a thrown error rather than swallowing it", async () => {
  await assert.rejects(() => withSpan("test.span", async () => { throw new Error("boom"); }), /boom/);
});

test("withSpan - passes a span object into fn", async () => {
  let receivedSpan: unknown;
  await withSpan("test.span", async (span) => {
    receivedSpan = span;
  });
  assert.ok(receivedSpan, "fn should receive a span argument");
});

test("withSpan - attributes option doesn't affect the resolved value", async () => {
  const result = await withSpan("test.span", async () => 42, { "test.attr": "value" });
  assert.strictEqual(result, 42);
});
