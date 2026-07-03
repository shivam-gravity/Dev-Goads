import "dotenv/config";
import express from "express";
import cors from "cors";
import { router } from "./gateway/router.js";
import { apiRateLimiter } from "./gateway/middleware/rateLimit.js";
import { requireAuth } from "./gateway/middleware/auth.js";
import "./db/db.js";

const app = express();
const PORT = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());
app.use(apiRateLimiter);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api", requireAuth, router);

app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`AdGo API gateway listening on http://localhost:${PORT}`);
});
