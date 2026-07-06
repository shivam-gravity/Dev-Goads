import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { router } from "./gateway/router.js";
import { apiRateLimiter } from "./gateway/middleware/rateLimit.js";
import { requireAuth } from "./gateway/middleware/auth.js";
import { registerEventHandlers } from "./infra/eventHandlers.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 4000);

registerEventHandlers();

app.use(cors());
app.use(express.json());
app.use(apiRateLimiter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// Serves blobs written via LocalFileObjectStorage (src/infra/objectStorage.ts) — a real
// S3/GCS/R2-backed implementation drops this static route in favor of signed URLs.
app.use("/objects", express.static(path.resolve(__dirname, "../data/objects")));

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
