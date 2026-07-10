import { randomUUID } from "node:crypto";
import { redisClient } from "./redisClient.js";
import { logger } from "../modules/logger/logger.js";
import type { DomainEvent, EventBus, EventHandler } from "./eventBus.js";

const STREAM_PREFIX = "events:"; // one stream per event type, e.g. "events:campaign.launched"
const CONSUMER_GROUP = "adgo-api";
const MAX_STREAM_LENGTH = 10_000; // approx trim (MAXLEN ~) — an audit trail, not unbounded storage
const READ_BLOCK_MS = 5000;
const READ_BATCH_SIZE = 10;
const EVENT_VERSION = "v1";

function streamKeyFor(type: string): string {
  return `${STREAM_PREFIX}${type}`;
}

function fieldsToRecord(fields: string[]): Record<string, string> {
  const record: Record<string, string> = {};
  for (let i = 0; i < fields.length; i += 2) record[fields[i]] = fields[i + 1];
  return record;
}

/**
 * Redis Streams-backed EventBus — the real implementation InMemoryEventBus's doc comment
 * (eventBus.ts) named as the eventual replacement, now that Redis Streams was specifically
 * asked for (unlike pgvector, Redis is already a live, working dependency in this stack —
 * see ResearchMemoryStore.ts's doc comment for the case where a requested real backend
 * genuinely wasn't installable; this one is). One stream per event type, a single shared
 * consumer group ("adgo-api") so multiple subscriber processes split the work rather than
 * each seeing every event, and explicit XACK only after a handler succeeds — a handler
 * that throws leaves its message unacked (visible in the stream's pending-entries list for
 * manual/future reclaim) rather than silently losing it, the same "don't lose a failure"
 * posture the BullMQ dead-letter queue (infra/deadLetterQueue.ts) takes for job queues.
 *
 * Every published event carries `version: "v1"` from day one (see feedback on the CRM
 * webhook dispatcher: version event payloads before there's a second version to migrate
 * to, not after).
 */
export class RedisStreamEventBus implements EventBus {
  async publish<T>(type: string, payload: T): Promise<void> {
    const occurredAt = new Date().toISOString();
    try {
      await redisClient.xadd(
        streamKeyFor(type),
        "MAXLEN",
        "~",
        MAX_STREAM_LENGTH,
        "*",
        "version",
        EVENT_VERSION,
        "type",
        type,
        "payload",
        JSON.stringify(payload),
        "occurredAt",
        occurredAt
      );
    } catch (err) {
      logger.error(`Failed to publish event "${type}" to Redis Stream`, err);
    }
  }

  /**
   * Runs a dedicated connection (`redisClient.duplicate()`) for this subscriber's
   * blocking XREADGROUP loop — sharing the main `redisClient` singleton for a blocking
   * read would stall every other command on that connection (locks, XADD, ...) for up to
   * READ_BLOCK_MS at a time, repeatedly. The returned unsubscribe function stops the loop
   * and closes this dedicated connection.
   */
  subscribe<T>(type: string, handler: EventHandler<T>): () => void {
    const streamKey = streamKeyFor(type);
    const consumerName = `consumer-${randomUUID()}`;
    const connection = redisClient.duplicate();
    let stopped = false;

    const loop = async () => {
      try {
        await connection.xgroup("CREATE", streamKey, CONSUMER_GROUP, "$", "MKSTREAM");
      } catch (err) {
        // BUSYGROUP means the group already exists — expected on every subscribe after
        // the first for this event type, not a real error.
        if (!(err instanceof Error && err.message.includes("BUSYGROUP"))) {
          logger.error(`Failed to create consumer group for ${streamKey}`, err);
        }
      }

      while (!stopped) {
        let results: [string, [string, string[]][]][] | null = null;
        try {
          results = (await connection.xreadgroup(
            "GROUP",
            CONSUMER_GROUP,
            consumerName,
            "COUNT",
            READ_BATCH_SIZE,
            "BLOCK",
            READ_BLOCK_MS,
            "STREAMS",
            streamKey,
            ">"
          )) as [string, [string, string[]][]][] | null;
        } catch (err) {
          if (!stopped) {
            logger.error(`Error reading from stream ${streamKey}`, err);
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          continue;
        }

        if (!results) continue;

        for (const [, messages] of results) {
          for (const [id, fields] of messages) {
            const record = fieldsToRecord(fields);
            const event: DomainEvent<T> = {
              type: record.type,
              payload: JSON.parse(record.payload),
              occurredAt: record.occurredAt,
            };
            try {
              await handler(event);
              await connection.xack(streamKey, CONSUMER_GROUP, id);
            } catch (handlerErr) {
              logger.error(`Event handler for "${type}" threw`, handlerErr);
            }
          }
        }
      }
    };

    void loop();

    return () => {
      stopped = true;
      // .disconnect(), not .quit() — quit() is graceful and waits for any in-flight
      // command's reply first, which means an already-in-flight blocking XREADGROUP can
      // still return a freshly-published message (and this handler still runs for it)
      // after unsubscribe() was called. disconnect() tears down the socket immediately,
      // aborting that in-flight read rather than letting it complete.
      connection.disconnect();
    };
  }
}

export const redisStreamEventBus: EventBus = new RedisStreamEventBus();
