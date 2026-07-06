import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request } from "express";
import cors from "cors";
import { router } from "./gateway/router.js";
import { metaOAuthRoutes } from "./gateway/metaOAuthRoutes.js";
import { googleOAuthRoutes } from "./gateway/googleOAuthRoutes.js";
import { metaLeadWebhookRoutes } from "./gateway/metaLeadWebhookRoutes.js";
import { adsDataRoutes } from "./gateway/adsDataRoutes.js";
import { crmInternalAuth } from "./gateway/middleware/crmInternalAuth.js";
import { apiRateLimiter } from "./gateway/middleware/rateLimit.js";
import { requireAuth } from "./gateway/middleware/auth.js";
import { registerEventHandlers } from "./infra/eventHandlers.js";

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

app.get("/health", (_req, res) => res.json({ status: "ok" }));

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

app.use("/api", requireAuth, router);

app.use((_req, res) => {
  res.status(404).json({ error: "Not found" });
});

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`AdGo API gateway listening on http://localhost:${PORT}`);
});
