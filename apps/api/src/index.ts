import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request } from "express";
import cors from "cors";
import { router, authEntryRouter } from "./gateway/router.js";
import { metaOAuthRoutes } from "./gateway/metaOAuthRoutes.js";
import { googleOAuthRoutes } from "./gateway/googleOAuthRoutes.js";
import { metaLeadWebhookRoutes } from "./gateway/metaLeadWebhookRoutes.js";
import { adsDataRoutes } from "./gateway/adsDataRoutes.js";
import { crmInternalAuth } from "./gateway/middleware/crmInternalAuth.js";
import { apiRateLimiter } from "./gateway/middleware/rateLimit.js";
import { requireAuth } from "./gateway/middleware/auth.js";
import { registerEventHandlers } from "./infra/eventHandlers.js";
import { prisma } from "./db/prisma.js";
import { redisClient } from "./infra/redisClient.js";
import { logger } from "./modules/logger/logger.js";
import { initErrorTracking, registerCrashReporting, captureError } from "./infra/errorTracking.js";

initErrorTracking("adgo-api");
registerCrashReporting("adgo-api");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 4000);

registerEventHandlers();

app.use(cors());
// Stashes the raw request body before JSON-parsing it, so the Meta leadgen webhook
// route (below) can verify its X-Hub-Signature-256 HMAC over the exact bytes Meta
// sent — re-serializing the parsed body would not reliably reproduce the same bytes.
app.use(express.json({ verify: (req: Request & { rawBody?: Buffer }, _res, buf) => { req.rawBody = buf; } }));
app.use(apiRateLimiter);

// Real connectivity checks, not a static "ok" — a gateway that can't reach Postgres or
// Redis is not actually healthy even though the Express process itself is up, and a
// load balancer/orchestrator relying on this endpoint needs to know that to route traffic
// (or restart the pod) accordingly. Each check is independent so one down dependency's
// failure doesn't throw before the other is checked.
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

// Serves blobs written via LocalFileObjectStorage (src/infra/objectStorage.ts) — a real
// S3/GCS/R2-backed implementation drops this static route in favor of signed URLs.
app.use("/objects", express.static(path.resolve(__dirname, "../data/objects")));

// Unauthenticated — Facebook's/Google's OAuth redirects carry no bearer token (see the respective routes files).
app.use("/api/integrations/meta/oauth", metaOAuthRoutes);
app.use("/api/integrations/google/oauth", googleOAuthRoutes);

// Unauthenticated at the HTTP layer by necessity (Meta calls this directly) — authenticity
// is instead verified per-request via the X-Hub-Signature-256 HMAC (see the route file).
app.use("/api/webhooks/meta", metaLeadWebhookRoutes);

// Server-to-server only: sales_tech_backend (the CRM) proxies its browser requests here
// with a shared secret (see crmInternalAuth) — never called directly from a browser.
app.use("/api/crm", crmInternalAuth, adsDataRoutes);

// Register/login/google: no bearer token exists yet when calling these, so they're
// mounted ahead of requireAuth (falls through to the gated router below if unmatched).
app.use("/api", authEntryRouter);
app.use("/api", requireAuth, router);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  captureError(err, { service: "adgo-api" });
  res.status(500).json({ error: "Internal server error" });
});

const server = app.listen(PORT, () => {
  console.log(`AdGo API gateway listening on http://localhost:${PORT}`);
});

// Stop accepting new connections and let in-flight requests finish before exiting —
// without this, a deploy/restart (SIGTERM) or Ctrl+C (SIGINT) kills requests mid-flight,
// which for this gateway can mean a client never learns whether a campaign launch or
// research job it just triggered actually started. A second signal (or the timeout)
// still forces the process down rather than hanging forever on one stuck connection.
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
