import { test } from "node:test";
import assert from "node:assert";
import { RedisStreamEventBus } from "../infra/redisStreamEventBus.js";
import type { DomainEvent } from "../infra/eventBus.js";
import { redisClient } from "../infra/redisClient.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Polls `check` until it returns true or `timeoutMs` elapses — used instead of a fixed
 * sleep to wait for the subscriber loop's async setup (XGROUP CREATE) without hardcoding
 * a single guessed delay everywhere it's needed. */
async function waitUntil(check: () => boolean, timeoutMs: number, intervalMs = 25): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (check()) return;
    await sleep(intervalMs);
  }
  throw new Error(`waitUntil timed out after ${timeoutMs}ms`);
}

test("RedisStreamEventBus - a subscriber receives an event published after it subscribes", async () => {
  const bus = new RedisStreamEventBus();
  const eventType = `test.event.${Date.now()}`;
  const received: DomainEvent<{ n: number }>[] = [];

  const unsubscribe = bus.subscribe<{ n: number }>(eventType, (event) => {
    received.push(event);
  });

  try {
    // The consumer group is created asynchronously inside subscribe()'s background
    // loop — give it a moment before publishing, same as any real consumer-group setup.
    await sleep(300);

    await bus.publish(eventType, { n: 42 });

    await waitUntil(() => received.length > 0, 8000);

    assert.strictEqual(received[0].type, eventType);
    assert.deepStrictEqual(received[0].payload, { n: 42 });
    assert.ok(received[0].occurredAt);
  } finally {
    unsubscribe();
  }
});

test("RedisStreamEventBus - publish never throws when there are zero subscribers", async () => {
  const bus = new RedisStreamEventBus();
  await assert.doesNotReject(() => bus.publish(`test.event.nosubscribers.${Date.now()}`, { ok: true }));
});

test("RedisStreamEventBus - unsubscribe stops delivering further events to that handler", async () => {
  const bus = new RedisStreamEventBus();
  const eventType = `test.event.${Date.now()}`;
  const received: DomainEvent<unknown>[] = [];

  const unsubscribe = bus.subscribe(eventType, (event) => {
    received.push(event);
  });

  await sleep(300);
  await bus.publish(eventType, { first: true });
  await waitUntil(() => received.length >= 1, 8000);

  unsubscribe();
  await sleep(200);

  await bus.publish(eventType, { second: true });
  await sleep(500);

  assert.strictEqual(received.length, 1, "no event should arrive after unsubscribe");
});

test.after(async () => {
  await redisClient.quit();
});
