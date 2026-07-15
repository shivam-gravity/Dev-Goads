import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * A single hard ceiling on combined LLM token usage across ALL FOUR providers (OpenAI,
 * Ollama, Gemini, Claude) together — distinct from openaiBudget.ts (which caps only
 * OpenAI's $ cost) and tokenMeter.ts (which is opt-in, in-memory-only, single-run
 * profiling). This is always-on and persistent: a real backstop against runaway usage
 * (a bug causing a retry storm, an unexpectedly large batch) regardless of which provider
 * a task happens to be routed to, since Ollama and Gemini's free tier have no $ signal of
 * their own to cap against the way OpenAI does.
 *
 * Enforcement is deliberately a hard stop with NO fallback: llmRouter.ts checks this
 * BEFORE dispatching to any provider (including before its own OpenAI-direct path and
 * before the fallback-to-OpenAI safety net), so once tripped, nothing attempts a call —
 * unlike openaiBudget.ts's cap, which degrades one provider into "not configured" and lets
 * the existing fallback chain keep going. That distinction is intentional: a per-provider
 * cap protects one provider's own budget from over-attribution, but a GLOBAL cap that still
 * let calls fall through to whichever provider is left would defeat the point of a combined
 * ceiling — the whole reason to have both is that they answer different questions.
 */

const LEDGER_PATH = process.env.LLM_USAGE_LEDGER_PATH ?? path.resolve(__dirname, "../../data", "llm-usage.json");

// Deliberately generous relative to any single provider's own cap — this exists to catch
// runaway usage (a retry storm, an unexpectedly large batch), not to be the primary lever
// for day-to-day cost control (that's openaiBudget.ts's job for OpenAI, and routing most
// tasks to free Ollama/Gemini for everything else).
const MONTHLY_TOKEN_BUDGET = Number(process.env.LLM_MONTHLY_TOKEN_BUDGET ?? 5_000_000);

interface Ledger {
  month: string; // "YYYY-MM", UTC
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
    // A write failure here means this call's tokens go untracked — never a reason to fail
    // the caller's actual, already-completed LLM call.
    // eslint-disable-next-line no-console
    console.warn("llmUsageBoundary: failed to persist usage ledger", err);
  }
}

export class LlmUsageBoundaryExceededError extends Error {
  constructor() {
    super(`Global LLM token budget exceeded for this month (cap: ${MONTHLY_TOKEN_BUDGET.toLocaleString()} tokens) — see infra/llmUsageBoundary.ts`);
    this.name = "LlmUsageBoundaryExceededError";
  }
}

export function isGlobalLlmUsageExceeded(): boolean {
  return readLedger().totalTokens >= MONTHLY_TOKEN_BUDGET;
}

/** Throws LlmUsageBoundaryExceededError once the month's combined usage hits the cap.
 * Callers (llmRouter.ts) must check this BEFORE attempting any provider — see the
 * "no fallback" rationale in this file's top comment. */
export function assertGlobalLlmUsageAvailable(): void {
  if (isGlobalLlmUsageExceeded()) throw new LlmUsageBoundaryExceededError();
}

export function recordGlobalLlmUsage(totalTokens: number): void {
  if (!(totalTokens > 0)) return;
  const ledger = readLedger();
  ledger.totalTokens += totalTokens;
  writeLedger(ledger);
}

export function getGlobalLlmMonthUsage(): number {
  return readLedger().totalTokens;
}

export function getGlobalLlmMonthlyBudget(): number {
  return MONTHLY_TOKEN_BUDGET;
}
