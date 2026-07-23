import { randomUUID } from "node:crypto";
import { prisma } from "../../db/prisma.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WalletBalance {
  workspaceId: string;
  balanceCents: number;
  currency: string;
  lastTopUpAt: string | null;
  updatedAt: string;
}

export interface WalletTransaction {
  id: string;
  workspaceId: string;
  type: "top_up" | "ad_spend" | "refund" | "adjustment";
  amountCents: number; // positive for credits, negative for debits
  balanceAfterCents: number;
  description: string;
  referenceId?: string; // campaignId, invoiceId, etc.
  createdAt: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function ensureWallet(workspaceId: string): Promise<WalletBalance> {
  const row = await prisma.wallet.findUnique({ where: { id: workspaceId } });
  if (row) return row.data as unknown as WalletBalance;

  const fresh: WalletBalance = {
    workspaceId,
    balanceCents: 0,
    currency: "usd",
    lastTopUpAt: null,
    updatedAt: new Date().toISOString(),
  };

  await prisma.wallet.create({
    data: { id: workspaceId, workspaceId, data: fresh as any },
  });

  return fresh;
}

async function persistBalance(balance: WalletBalance): Promise<void> {
  balance.updatedAt = new Date().toISOString();
  await prisma.wallet.upsert({
    where: { id: balance.workspaceId },
    create: { id: balance.workspaceId, workspaceId: balance.workspaceId, data: balance as any },
    update: { data: balance as any },
  });
}

async function recordTransaction(txn: WalletTransaction): Promise<void> {
  await prisma.walletTransaction.create({
    data: { id: txn.id, workspaceId: txn.workspaceId, data: txn as any, createdAt: new Date(txn.createdAt) },
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Returns the current wallet balance for the workspace, creating a zero-balance wallet if none exists. */
export async function getWalletBalance(workspaceId: string): Promise<WalletBalance> {
  return ensureWallet(workspaceId);
}

/** Adds funds to the wallet. Returns the recorded transaction. */
export async function topUpWallet(
  workspaceId: string,
  amountCents: number,
  description?: string,
): Promise<WalletTransaction> {
  if (amountCents <= 0) throw new Error("Top-up amount must be positive");

  const balance = await ensureWallet(workspaceId);
  balance.balanceCents += amountCents;
  balance.lastTopUpAt = new Date().toISOString();
  await persistBalance(balance);

  const txn: WalletTransaction = {
    id: randomUUID(),
    workspaceId,
    type: "top_up",
    amountCents,
    balanceAfterCents: balance.balanceCents,
    description: description ?? `Top-up of ${(amountCents / 100).toFixed(2)} ${balance.currency.toUpperCase()}`,
    createdAt: new Date().toISOString(),
  };
  await recordTransaction(txn);
  return txn;
}

/** Deducts ad spend from the wallet. Throws if insufficient funds. Returns the recorded transaction. */
export async function deductFromWallet(
  workspaceId: string,
  amountCents: number,
  referenceId?: string,
  description?: string,
): Promise<WalletTransaction> {
  if (amountCents <= 0) throw new Error("Deduction amount must be positive");

  const balance = await ensureWallet(workspaceId);
  if (balance.balanceCents < amountCents) {
    throw new Error(
      `Insufficient wallet funds: required ${amountCents} cents but balance is ${balance.balanceCents} cents`,
    );
  }

  balance.balanceCents -= amountCents;
  await persistBalance(balance);

  const txn: WalletTransaction = {
    id: randomUUID(),
    workspaceId,
    type: "ad_spend",
    amountCents: -amountCents, // negative = debit
    balanceAfterCents: balance.balanceCents,
    description: description ?? `Ad spend deduction of ${(amountCents / 100).toFixed(2)} ${balance.currency.toUpperCase()}`,
    referenceId,
    createdAt: new Date().toISOString(),
  };
  await recordTransaction(txn);
  return txn;
}

/** Adds a refund credit to the wallet. Returns the recorded transaction. */
export async function refundToWallet(
  workspaceId: string,
  amountCents: number,
  referenceId?: string,
  description?: string,
): Promise<WalletTransaction> {
  if (amountCents <= 0) throw new Error("Refund amount must be positive");

  const balance = await ensureWallet(workspaceId);
  balance.balanceCents += amountCents;
  await persistBalance(balance);

  const txn: WalletTransaction = {
    id: randomUUID(),
    workspaceId,
    type: "refund",
    amountCents,
    balanceAfterCents: balance.balanceCents,
    description: description ?? `Refund of ${(amountCents / 100).toFixed(2)} ${balance.currency.toUpperCase()}`,
    referenceId,
    createdAt: new Date().toISOString(),
  };
  await recordTransaction(txn);
  return txn;
}

/** Returns recent wallet transactions, most recent first. */
export async function listWalletTransactions(workspaceId: string, limit = 50): Promise<WalletTransaction[]> {
  const rows = await prisma.walletTransaction.findMany({
    where: { workspaceId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => r.data as unknown as WalletTransaction);
}

/** Returns true if the workspace cannot cover the required spend amount. */
export async function hasInsufficientFunds(workspaceId: string, requiredCents: number): Promise<boolean> {
  const balance = await ensureWallet(workspaceId);
  return balance.balanceCents < requiredCents;
}
