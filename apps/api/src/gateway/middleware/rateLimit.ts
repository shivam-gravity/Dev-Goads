import rateLimit from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { redisClient } from "../../infra/redisClient.js";

const IS_PROD = process.env.NODE_ENV === "production";

function makeRedisStore(prefix: string) {
  if (!IS_PROD) return undefined;
  // ioredis's `call(command, ...args)` is the raw-command entry point rate-limit-redis expects
  // (its own `sendCommand` takes a Command object, not a string[]). `call` is typed to return
  // Promise<unknown>, so we assert the RedisReply shape the store's SendCommandFn requires.
  return new RedisStore({
    sendCommand: (command: string, ...args: string[]) => redisClient.call(command, ...args) as Promise<RedisReply>,
    prefix,
  });
}

export const apiRateLimiter = rateLimit({
  windowMs: 60_000,
  limit: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Rate limit exceeded, slow down." },
  store: makeRedisStore("rl:api:"),
});

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many auth attempts, try again later." },
  store: makeRedisStore("rl:auth:"),
});
