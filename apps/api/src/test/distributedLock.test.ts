import { test } from "node:test";
import assert from "node:assert";
import { acquireLock, withLock, withQueuedLock, LockAlreadyHeldError, LockWaitTimeoutError } from "../infra/distributedLock.js";
import { redisClient } from "../infra/redisClient.js";

test("distributedLock - acquireLock succeeds on a free key and fails while it's held", async () => {
  const key = `test-lock-${Date.now()}`;

  const lock = await acquireLock(key, 5000);
  assert.ok(lock, "should acquire a free key");

  const second = await acquireLock(key, 5000);
  assert.strictEqual(second, null, "a second acquire on the same key must fail while held");

  await lock!.release();
});

test("distributedLock - release() frees the key for a subsequent acquire", async () => {
  const key = `test-lock-${Date.now()}`;

  const lock = await acquireLock(key, 5000);
  await lock!.release();

  const reacquired = await acquireLock(key, 5000);
  assert.ok(reacquired, "should be able to re-acquire after release");
  await reacquired!.release();
});

test("withLock - runs fn while holding the lock, then releases it even on success", async () => {
  const key = `test-lock-${Date.now()}`;
  let ranInsideLock = false;

  const result = await withLock(key, 5000, async () => {
    ranInsideLock = true;
    const contested = await acquireLock(key, 5000);
    assert.strictEqual(contested, null, "the key must be held while fn is running");
    return "done";
  });

  assert.strictEqual(result, "done");
  assert.strictEqual(ranInsideLock, true);

  const afterRelease = await acquireLock(key, 5000);
  assert.ok(afterRelease, "the lock must be released once withLock's fn resolves");
  await afterRelease!.release();
});

test("withLock - releases the lock even when fn throws", async () => {
  const key = `test-lock-${Date.now()}`;

  await assert.rejects(() => withLock(key, 5000, async () => { throw new Error("boom"); }), /boom/);

  const afterThrow = await acquireLock(key, 5000);
  assert.ok(afterThrow, "the lock must be released even when fn threw");
  await afterThrow!.release();
});

test("withLock - throws LockAlreadyHeldError immediately when the key is already held, without waiting", async () => {
  const key = `test-lock-${Date.now()}`;
  const lock = await acquireLock(key, 5000);

  await assert.rejects(() => withLock(key, 5000, async () => "should not run"), LockAlreadyHeldError);

  await lock!.release();
});

test("withQueuedLock - acquires immediately when the key is free", async () => {
  const key = `test-queued-lock-${Date.now()}`;

  const result = await withQueuedLock(key, 5000, 5000, async () => "done");

  assert.strictEqual(result, "done");
  const afterRelease = await acquireLock(key, 5000);
  assert.ok(afterRelease, "the lock must be released once withQueuedLock's fn resolves");
  await afterRelease!.release();
});

test("withQueuedLock - waits for a held lock and completes only after the holder releases", async () => {
  const key = `test-queued-lock-${Date.now()}`;
  const events: string[] = [];

  const holder = await acquireLock(key, 5000);
  assert.ok(holder);

  const queuedPromise = withQueuedLock(key, 5000, 5000, async () => {
    events.push("queued-ran");
    return "queued-done";
  });

  // Give withQueuedLock's poll loop a couple of cycles to observe the lock as held
  // (LOCK_POLL_INTERVAL_MS is 500ms) before releasing the original holder.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepStrictEqual(events, [] as string[], "fn must not have run yet while the original holder still holds the lock");
  events.push("released-holder");
  await holder!.release();

  const result = await queuedPromise;
  assert.strictEqual(result, "queued-done");
  assert.deepStrictEqual(events, ["released-holder", "queued-ran"], "queued fn must only run after the original holder released");
});

test("withQueuedLock - throws LockWaitTimeoutError when the key stays held past maxWaitMs", async () => {
  const key = `test-queued-lock-${Date.now()}`;
  const holder = await acquireLock(key, 5000);
  assert.ok(holder);

  await assert.rejects(
    () => withQueuedLock(key, 5000, 800, async () => "should not run"),
    LockWaitTimeoutError
  );

  await holder!.release();
});

test.after(async () => {
  await redisClient.quit();
});
