import { test } from "node:test";
import assert from "node:assert";
import { acquireLock, withLock, LockAlreadyHeldError } from "../infra/distributedLock.js";
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

test.after(async () => {
  await redisClient.quit();
});
