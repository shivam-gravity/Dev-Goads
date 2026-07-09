import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

// Must be the first import in index.ts — ES module imports execute in
// declaration order, so anything imported after this can safely assume
// process.env is populated. Shares apps/api's .env rather than duplicating
// secrets (OPENAI_API_KEY, INTERNAL_SERVICE_KEY) across services.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../api/.env") });
