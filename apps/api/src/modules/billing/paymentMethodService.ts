import { prisma } from "../../db/prisma.js";

export interface PaymentMethodInput {
  cardNumber: string;
  expiry: string; // MM/YY
  cvc: string;
}

// What's actually persisted — deliberately excludes the card number and CVC entirely.
// This is a demo/mock payment form (no real processor is wired up), but a card number and
// CVC must never be written to disk regardless, even here.
export interface PaymentMethod {
  workspaceId: string;
  brand: "visa" | "mastercard" | "amex" | "discover" | "unknown";
  last4: string;
  expiry: string;
  updatedAt: string;
}

function luhnValid(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if (alternate) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

function detectBrand(digits: string): PaymentMethod["brand"] {
  if (/^4/.test(digits)) return "visa";
  if (/^(5[1-5]|2[2-7])/.test(digits)) return "mastercard";
  if (/^3[47]/.test(digits)) return "amex";
  if (/^(6011|65)/.test(digits)) return "discover";
  return "unknown";
}

export function validatePaymentMethodInput(input: PaymentMethodInput): string | null {
  const digits = input.cardNumber.replace(/\s+/g, "");
  if (!/^\d{13,19}$/.test(digits) || !luhnValid(digits)) return "Card number is invalid";
  if (!/^\d{2}\/\d{2}$/.test(input.expiry.trim())) return "Expiry must be in MM/YY format";
  const [monthStr, yearStr] = input.expiry.trim().split("/");
  const month = Number(monthStr);
  if (month < 1 || month > 12) return "Expiry month is invalid";
  const expiryDate = new Date(2000 + Number(yearStr), month, 0);
  if (expiryDate < new Date()) return "Card has expired";
  if (!/^\d{3,4}$/.test(input.cvc.trim())) return "CVC is invalid";
  return null;
}

export async function getPaymentMethod(workspaceId: string): Promise<PaymentMethod | null> {
  const row = await prisma.paymentMethod.findFirst({ where: { workspaceId }, orderBy: { createdAt: "desc" } });
  return row ? (row.data as unknown as PaymentMethod) : null;
}

export async function setPaymentMethod(workspaceId: string, input: PaymentMethodInput): Promise<PaymentMethod> {
  const digits = input.cardNumber.replace(/\s+/g, "");
  const method: PaymentMethod = {
    workspaceId,
    brand: detectBrand(digits),
    last4: digits.slice(-4),
    expiry: input.expiry.trim(),
    updatedAt: new Date().toISOString(),
  };
  await prisma.paymentMethod.upsert({
    where: { id: workspaceId },
    create: { id: workspaceId, workspaceId, data: method as any },
    update: { data: method as any },
  });
  return method;
}
