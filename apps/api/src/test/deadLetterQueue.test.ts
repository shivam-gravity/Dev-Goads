import { test } from "node:test";
import assert from "node:assert";
import type { Job } from "bullmq";
import { isFinalFailure, listDeadLetterEntries, sendToDeadLetter } from "../infra/deadLetterQueue.js";

function fakeJob(attemptsMade: number, attempts?: number): Job {
  return { attemptsMade, opts: { attempts } } as unknown as Job;
}

test("isFinalFailure - true once attemptsMade reaches the configured attempts ceiling", () => {
  assert.strictEqual(isFinalFailure(fakeJob(3, 3)), true);
  assert.strictEqual(isFinalFailure(fakeJob(4, 3)), true, "past the ceiling still counts as final");
});

test("isFinalFailure - false while attemptsMade is still below the ceiling", () => {
  assert.strictEqual(isFinalFailure(fakeJob(1, 3)), false);
  assert.strictEqual(isFinalFailure(fakeJob(2, 3)), false);
});

test("isFinalFailure - defaults the ceiling to 1 (no retry configured) when opts.attempts is unset", () => {
  assert.strictEqual(isFinalFailure(fakeJob(1, undefined)), true);
});

test("sendToDeadLetter - persists a queryable entry, retrievable via listDeadLetterEntries", async () => {
  const queue = `test-queue-${Date.now()}`;

  await sendToDeadLetter(queue, { name: "test-job", data: { foo: "bar" }, attemptsMade: 2 }, new Error("boom"));

  const entries = await listDeadLetterEntries(queue);
  assert.strictEqual(entries.length, 1);
  assert.strictEqual(entries[0].queue, queue);
  assert.strictEqual(entries[0].jobName, "test-job");
  assert.deepStrictEqual(entries[0].jobData, { foo: "bar" });
  assert.strictEqual(entries[0].error, "boom");
  assert.strictEqual(entries[0].attemptsMade, 2);
});

test("listDeadLetterEntries - filters by queue and respects the limit", async () => {
  const queueA = `test-queue-a-${Date.now()}`;
  const queueB = `test-queue-b-${Date.now()}`;

  await sendToDeadLetter(queueA, { name: "job-1", data: {}, attemptsMade: 1 }, new Error("e1"));
  await sendToDeadLetter(queueA, { name: "job-2", data: {}, attemptsMade: 1 }, new Error("e2"));
  await sendToDeadLetter(queueB, { name: "job-3", data: {}, attemptsMade: 1 }, new Error("e3"));

  const onlyA = await listDeadLetterEntries(queueA);
  assert.strictEqual(onlyA.length, 2);
  assert.ok(onlyA.every((e) => e.queue === queueA));

  const limited = await listDeadLetterEntries(queueA, 1);
  assert.strictEqual(limited.length, 1);
});
