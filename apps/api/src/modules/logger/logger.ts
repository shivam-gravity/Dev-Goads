import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOG_FILE_PATH = path.resolve(__dirname, "../../../data/api_production.log");

// Ensure data folder exists
const dataDir = path.dirname(LOG_FILE_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function writeToFile(level: string, message: string, meta?: any) {
  const timestamp = new Date().toISOString();
  const metaString = meta ? ` | Meta: ${JSON.stringify(meta)}` : "";
  const logLine = `[${timestamp}] [${level.toUpperCase()}] ${message}${metaString}\n`;
  try {
    fs.appendFileSync(LOG_FILE_PATH, logLine, "utf-8");
  } catch (err) {
    console.error("Failed to write to API log file:", err);
  }
}

export const logger = {
  info(message: string, meta?: any) {
    const timestamp = new Date().toLocaleTimeString();
    console.log(`\x1b[32m[INFO] [${timestamp}]\x1b[0m ${message}`, meta ? meta : "");
    writeToFile("info", message, meta);
  },

  warn(message: string, meta?: any) {
    const timestamp = new Date().toLocaleTimeString();
    console.warn(`\x1b[33m[WARN] [${timestamp}]\x1b[0m ${message}`, meta ? meta : "");
    writeToFile("warn", message, meta);
  },

  error(message: string, error?: any, meta?: any) {
    const timestamp = new Date().toLocaleTimeString();
    const errMsg = error instanceof Error ? error.message : String(error || "");
    const fullMsg = `${message} | Error: ${errMsg}`;
    console.error(`\x1b[31m[ERROR] [${timestamp}]\x1b[0m ${fullMsg}`, meta ? meta : "");
    writeToFile("error", fullMsg, { ...meta, stack: error instanceof Error ? error.stack : undefined });
  }
};
