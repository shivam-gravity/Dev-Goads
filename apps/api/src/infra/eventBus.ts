import { EventEmitter } from "node:events";
import { logger } from "../modules/logger/logger.js";
import { RedisStreamEventBus } from "./redisStreamEventBus.js";

/**
 * Provider-agnostic pub/sub for domain events. The shape mirrors what a Kafka
 * producer/consumer pair looks like (topic + payload, fire-and-forget publish,
 * many independent subscribers) so swapping InMemoryEventBus for a Kafka-backed
 * implementation later (roadmap Phase 3) doesn't require call sites to change —
 * only the implementation behind this interface.
 */
export interface DomainEvent<T = unknown> {
  type: string;
  payload: T;
  occurredAt: string;
}

export type EventHandler<T = unknown> = (event: DomainEvent<T>) => void | Promise<void>;

export interface EventBus {
  publish<T>(type: string, payload: T): Promise<void>;
  subscribe<T>(type: string, handler: EventHandler<T>): () => void;
}

/**
 * In-process pub/sub for local development. Publishing never blocks on
 * subscribers and a handler throwing never breaks the publisher — the same
 * failure isolation a real broker gives you between producer and consumer.
 */
export class InMemoryEventBus implements EventBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(50);
  }

  async publish<T>(type: string, payload: T): Promise<void> {
    const event: DomainEvent<T> = { type, payload, occurredAt: new Date().toISOString() };
    for (const handler of this.emitter.listeners(type) as EventHandler<T>[]) {
      Promise.resolve()
        .then(() => handler(event))
        .catch((err) => logger.error(`Event handler for "${type}" threw`, err));
    }
  }

  subscribe<T>(type: string, handler: EventHandler<T>): () => void {
    this.emitter.on(type, handler as (...args: unknown[]) => void);
    return () => this.emitter.off(type, handler as (...args: unknown[]) => void);
  }
}

// Redis Streams-backed by default (see redisStreamEventBus.ts) — InMemoryEventBus above
// stays exported for tests that want pub/sub without a real Redis round-trip, and as the
// reference implementation of the EventBus contract.
export const eventBus: EventBus = new RedisStreamEventBus();
