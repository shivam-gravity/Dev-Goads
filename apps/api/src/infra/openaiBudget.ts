import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Enforces a hard monthly spend cap on THIS app's own OpenAI usage. The user's OpenAI
 * account is shared across other, unrelated projects with a combined ~$10/month budget —
 * this ledger caps what this app alone draws from that (default: 10%, i.e. $1/month) so a
 * busy month here can't quietly eat the allowance those other projects need too.
 *
 * Important limitation: this ledger only sees calls made through this app's own
 * openaiClient.ts (and scraper-service's, which points at the same LEDGER_PATH). It has no
 * visibility into spend from other projects sharing the same OpenAI account — the real
 * account-wide remaining budget may be lower than what "under this app's cap" implies.
 *
 * Plain JSON file, not a DB table: this is a soft safety net, not billing-grade accounting
 * (see the approximate-pricing comment below), and a monorepo-wide shared file is simpler
 * than adding a migration+shared-DB-access path across apps/api and apps/scraper-service
 * for what's fundamentally a best-effort guard, not a source of truth OpenAI itself owns.
 */

// Anchored to this file's own location (not process.cwd()) so apps/api and
// apps/scraper-service — run from different working directories — resolve to the exact
// same shared ledger file by default, rather than each tracking their own independent
// (and therefore double-counted) $-cap.
const LEDGER_PATH = process.env.OPENAI_SPEND_LEDGER_PATH ?? path.resolve(__dirname, "../../data", "openai-spend.json");

// Default: 10% of a $10/month shared account, per the user's stated policy. Override with
// OPENAI_MONTHLY_BUDGET_USD if the shared account's total or this app's slice changes.
const MONTHLY_BUDGET_USD = Number(process.env.OPENAI_MONTHLY_BUDGET_USD ?? 1);

interface Ledger {
  month: string; // "YYYY-MM", UTC
  spentUsd: number;
}

function currentMonthKey(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function emptyLedger(): Ledger {
  return { month: currentMonthKey(), spentUsd: 0 };
}

function readLedger(): Ledger {
  try {
    const raw = fs.readFileSync(LEDGER_PATH, "utf8");
    const parsed = JSON.parse(raw) as Ledger;
    if (parsed.month === currentMonthKey() && typeof parsed.spentUsd === "number") return parsed;
  } catch {
    // No ledger yet, unreadable, or corrupt — start the month fresh rather than block calls.
  }
  return emptyLedger();
}

function writeLedger(ledger: Ledger): void {
  try {
    fs.mkdirSync(path.dirname(LEDGER_PATH), { recursive: true });
    fs.writeFileSync(LEDGER_PATH, JSON.stringify(ledger), "utf8");
  } catch (err) {
    // Budget tracking is a safety net around the real API call, never a reason to fail it —
    // a write failure here just means this one call's cost goes untracked.
    // eslint-disable-next-line no-console
    console.warn("openaiBudget: failed to persist spend ledger", err);
  }
}

/** True once this month's tracked OpenAI spend has reached the cap — callers treat this
 * exactly like "OPENAI_API_KEY not set" (see openaiClient.ts), so every existing fallback
 * path (llmRouter's fallback-to-OpenAI, providers' own `if (!openai)` guards once the call
 * throws) already degrades gracefully without new plumbing. */
export function isOpenAIBudgetExceeded(): boolean {
  return readLedger().spentUsd >= MONTHLY_BUDGET_USD;
}

export function recordOpenAISpend(costUsd: number): void {
  if (!(costUsd > 0)) return;
  const ledger = readLedger();
  ledger.spentUsd += costUsd;
  writeLedger(ledger);
}

export function getOpenAIMonthSpendUsd(): number {
  return readLedger().spentUsd;
}

export function getOpenAIMonthlyBudgetUsd(): number {
  return MONTHLY_BUDGET_USD;
}

// Approximate published OpenAI pricing (USD/1M tokens) — good enough to enforce a soft
// monthly cap, NOT reconciled against actual invoices. Re-check platform.openai.com/pricing
// periodically; these drift as OpenAI repriced models.
const PRICE_PER_1M_INPUT_TOKENS: Record<string, number> = {
  "gpt-4o": 2.5,
  "gpt-4o-search-preview": 2.5,
};
const PRICE_PER_1M_OUTPUT_TOKENS: Record<string, number> = {
  "gpt-4o": 10,
  "gpt-4o-search-preview": 10,
};
const PRICE_PER_1M_EMBEDDING_TOKENS: Record<string, number> = {
  "text-embedding-3-small": 0.02,
};
// gpt-4o-search-preview bills a flat per-call web-search tool fee on top of token pricing —
// approximated at the "medium" search-context-size published rate.
const SEARCH_TOOL_FEE_USD = 0.035;
// gpt-image-1 bills per image, varying by size/quality — approximated at the "medium
// quality" rate since imageProvider.ts's supported sizes cluster around there.
const IMAGE_COST_USD = 0.04;

export function computeChatCostUsd(model: string, usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined): number {
  if (!usage) return 0;
  const inputRate = PRICE_PER_1M_INPUT_TOKENS[model] ?? PRICE_PER_1M_INPUT_TOKENS["gpt-4o"];
  const outputRate = PRICE_PER_1M_OUTPUT_TOKENS[model] ?? PRICE_PER_1M_OUTPUT_TOKENS["gpt-4o"];
  const inputCost = ((usage.prompt_tokens ?? 0) / 1_000_000) * inputRate;
  const outputCost = ((usage.completion_tokens ?? 0) / 1_000_000) * outputRate;
  return inputCost + outputCost;
}

export function computeSearchCostUsd(model: string, usage: { prompt_tokens?: number; completion_tokens?: number } | null | undefined): number {
  return computeChatCostUsd(model, usage) + SEARCH_TOOL_FEE_USD;
}

export function computeEmbeddingCostUsd(model: string, totalTokens: number | null | undefined): number {
  const rate = PRICE_PER_1M_EMBEDDING_TOKENS[model] ?? PRICE_PER_1M_EMBEDDING_TOKENS["text-embedding-3-small"];
  return ((totalTokens ?? 0) / 1_000_000) * rate;
}

export function computeImageCostUsd(): number {
  return IMAGE_COST_USD;
}
