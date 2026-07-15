import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mirrors apps/api/src/infra/openaiBudget.ts (see that file's doc comment for the full
 * rationale — shared OpenAI account, other unrelated projects draw from the same monthly
 * budget). Points at the SAME ledger file api uses by default (anchored to this file's own
 * location, not process.cwd(), so both services agree on the path regardless of which
 * directory each is actually run from) so spend from this service and apps/api count
 * against one shared cap instead of each getting its own independent (and effectively
 * doubled) budget.
 */

const LEDGER_PATH = process.env.OPENAI_SPEND_LEDGER_PATH ?? path.resolve(__dirname, "../../api/data", "openai-spend.json");
const MONTHLY_BUDGET_USD = Number(process.env.OPENAI_MONTHLY_BUDGET_USD ?? 1);

interface Ledger {
  month: string;
  spentUsd: number;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function readLedger(): Ledger {
  try {
    const raw = fs.readFileSync(LEDGER_PATH, "utf8");
    const parsed = JSON.parse(raw) as Ledger;
    if (parsed.month === currentMonthKey() && typeof parsed.spentUsd === "number") return parsed;
  } catch {
    // No ledger yet, unreadable, or corrupt — start the month fresh rather than block calls.
  }
  return { month: currentMonthKey(), spentUsd: 0 };
}

function writeLedger(ledger: Ledger): void {
  try {
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger), "utf8");
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn("openaiBudget: failed to persist spend ledger", err);
  }
}

export function isOpenAIBudgetExceeded(): boolean {
  return readLedger().spentUsd >= MONTHLY_BUDGET_USD;
}

export function recordOpenAISpend(costUsd: number): void {
  if (!(costUsd > 0)) return;
  const ledger = readLedger();
  ledger.spentUsd += costUsd;
  writeLedger(ledger);
}

// Approximate published OpenAI pricing (USD/1M tokens) — see apps/api's openaiBudget.ts for
// the same caveat: good enough for a soft cap, not reconciled against actual invoices.
const PRICE_PER_1M_INPUT_TOKENS: Record<string, number> = { "gpt-4o": 2.5 };
const PRICE_PER_1M_OUTPUT_TOKENS: Record<string, number> = { "gpt-4o": 10 };

export function computeChatCostUsd(model: string, usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined): number {
  if (!usage) return 0;
  const inputRate = PRICE_PER_1M_INPUT_TOKENS[model] ?? PRICE_PER_1M_INPUT_TOKENS["gpt-4o"];
  const outputRate = PRICE_PER_1M_OUTPUT_TOKENS[model] ?? PRICE_PER_1M_OUTPUT_TOKENS["gpt-4o"];
  const inputCost = ((usage.prompt_tokens ?? 0) / 1_000_000) * inputRate;
  const outputCost = ((usage.completion_tokens ?? 0) / 1_000_000) * outputRate;
  return inputCost + outputCost;
}
