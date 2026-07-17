import "dotenv/config";
import express, { type Request } from "express";
import cors from "cors";
import { router, authEntryRouter } from "./gateway/router.js";
import { metaOAuthRoutes } from "./gateway/metaOAuthRoutes.js";
import { googleOAuthRoutes } from "./gateway/googleOAuthRoutes.js";
import { crmInternalAuth } from "./gateway/middleware/crmInternalAuth.js";
import { apiRateLimiter } from "./gateway/middleware/rateLimit.js";
import { requireAuth } from "./gateway/middleware/auth.js";
import { prisma } from "./db/prisma.js";
import { redisClient } from "./infra/redisClient.js";
import { logger } from "./modules/logger/logger.js";
import { initErrorTracking, registerCrashReporting, captureError } from "./infra/errorTracking.js";

initErrorTracking("polluxa-api");
registerCrashReporting("polluxa-api");

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json({ verify: (req: Request & { rawBody?: Buffer }, _res, buf) => { req.rawBody = buf; } }));
app.use(apiRateLimiter);

app.get("/health", async (_req, res) => {
  const checks: Record<string, "ok" | "error"> = { postgres: "ok", redis: "ok" };

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    checks.postgres = "error";
    logger.error("Health check: Postgres unreachable", err);
  }

  try {
    await redisClient.ping();
  } catch (err) {
    checks.redis = "error";
    logger.error("Health check: Redis unreachable", err);
  }

  const healthy = Object.values(checks).every((status) => status === "ok");
  res.status(healthy ? 200 : 503).json({ status: healthy ? "ok" : "degraded", checks });
});

// OAuth callbacks (unauthenticated — platform redirects carry no bearer token)
app.use("/api/integrations/meta/oauth", metaOAuthRoutes);
app.use("/api/integrations/google/oauth", googleOAuthRoutes);

// Register/login: no bearer token yet
app.use("/api", authEntryRouter);
app.use("/api", requireAuth, router);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  captureError(err, { service: "polluxa-api" });
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`Polluxa API gateway listening on http://localhost:${PORT}`);
});

const SHUTDOWN_FORCE_EXIT_MS = 10_000;
let shuttingDown = false;

function gracefulShutdown(signal: string) {
  if (shuttingDown) {
    logger.warn(`Received ${signal} again during shutdown — forcing exit`);
    process.exit(1);
  }
  shuttingDown = true;
  logger.info(`Received ${signal} — closing gracefully (in-flight requests get ${SHUTDOWN_FORCE_EXIT_MS}ms to finish)`);

  const forceExit = setTimeout(() => {
    logger.error(`Graceful shutdown timed out after ${SHUTDOWN_FORCE_EXIT_MS}ms — forcing exit`);
    process.exit(1);
  }, SHUTDOWN_FORCE_EXIT_MS);
  forceExit.unref();

  server.close((err) => {
    if (err) logger.error("Error while closing HTTP server", err);
    process.exit(err ? 1 : 0);
  });
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));
