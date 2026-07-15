import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mirrors apps/api/src/infra/llmUsageBoundary.ts (see that file for the full rationale) —
 * points at the SAME shared ledger file so this service's LLM usage counts against one
 * combined monthly ceiling alongside apps/api's four-provider usage, rather than each
 * service getting its own independent (and therefore doubled) allowance.
 */

const LEDGER_PATH = process.env.LLM_USAGE_LEDGER_PATH ?? path.resolve(__dirname, "../../api/data", "llm-usage.json");
const MONTHLY_TOKEN_BUDGET = Number(process.env.LLM_MONTHLY_TOKEN_BUDGET ?? 5_000_000);

interface Ledger {
  month: string;
  totalTokens: number;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function readLedger(): Ledger {
  try {
    const raw = fs.readFileSync(LEDGER_PATH, "utf8");
    const parsed = JSON.parse(raw) as Ledger;
    if (parsed.month === currentMonthKey() && typeof parsed.totalTokens === "number") return parsed;
  } catch {
    // No ledger yet, unreadable, or corrupt — start the month fresh rather than block calls.
  }
  return { month: currentMonthKey(), totalTokens: 0 };
}

function writeLedger(ledger: Ledger): void {
  try {
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger), "utf8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("llmUsageBoundary: failed to persist usage ledger", err);
  }
}

export function isGlobalLlmUsageExceeded(): boolean {
  return readLedger().totalTokens >= MONTHLY_TOKEN_BUDGET;
}

export function assertGlobalLlmUsageAvailable(): void {
  if (isGlobalLlmUsageExceeded()) {
    throw new Error(`Global LLM token budget exceeded for this month (cap: ${MONTHLY_TOKEN_BUDGET.toLocaleString()} tokens) — see llmUsageBoundary.ts`);
  }
}

export function recordGlobalLlmUsage(totalTokens: number): void {
  if (!(totalTokens > 0)) return;
  const ledger = readLedger();
  ledger.totalTokens += totalTokens;
  writeLedger(ledger);
}
