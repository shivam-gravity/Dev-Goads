import { randomUUID, createHash } from "node:crypto";
import { prisma } from "../../db/prisma.js";

const REFRESH_TOKEN_EXPIRY_DAYS = 90;

function hashToken(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export async function issueRefreshToken(userId: string, family?: string): Promise<string> {
  const plaintext = randomUUID();
  const tokenHash = hashToken(plaintext);
  const resolvedFamily = family ?? randomUUID();
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  await prisma.refreshToken.create({
    data: { id: randomUUID(), userId, tokenHash, family: resolvedFamily, expiresAt },
  });

  return plaintext;
}

export interface RotationResult {
  newPlaintext: string;
  userId: string;
  family: string;
}

export async function rotateRefreshToken(oldPlaintext: string): Promise<RotationResult> {
  const oldHash = hashToken(oldPlaintext);
  const existing = await prisma.refreshToken.findUnique({ where: { tokenHash: oldHash } });

  if (!existing) throw new Error("Invalid refresh token");

  if (existing.revokedAt) {
    await revokeFamily(existing.family);
    throw new Error("Refresh token reuse detected — entire session revoked");
  }

  if (existing.expiresAt < new Date()) {
    throw new Error("Refresh token expired");
  }

  const newPlaintext = randomUUID();
  const newHash = hashToken(newPlaintext);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  const newId = randomUUID();

  await prisma.$transaction([
    prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedBy: newId },
    }),
    prisma.refreshToken.create({
      data: { id: newId, userId: existing.userId, tokenHash: newHash, family: existing.family, expiresAt },
    }),
  ]);

  return { newPlaintext, userId: existing.userId, family: existing.family };
}

export async function revokeFamily(family: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { family, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAllForUser(userId: string): Promise<void> {
  await prisma.refreshToken.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
