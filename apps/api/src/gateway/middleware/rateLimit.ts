import rateLimit from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { redisClient } from "../../infra/redisClient.js";

const IS_PROD = process.env.NODE_ENV === "production";

function makeRedisStore(prefix: string) {
  if (!IS_PROD) return undefined;
  return new RedisStore({ sendCommand: (...args: string[]) => redisClient.sendCommand(args), prefix });
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
