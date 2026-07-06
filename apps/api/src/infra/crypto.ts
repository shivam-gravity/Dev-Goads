import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM encryption for OAuth tokens at rest (e.g. inside the Integration.data
 * Json blob). Ciphertext is packed as `iv:authTag:data` (all hex) so it round-trips
 * through a single string column/field with no extra schema.
 */
const ALGORITHM = "aes-256-gcm";

function getKey(): Buffer {
  const hex = process.env.TOKEN_ENCRYPTION_KEY;
  if (!hex) throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  const key = Buffer.from(hex, "hex");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY must be a 32-byte (64 hex char) key");
  return key;
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

export function decryptToken(packed: string): string {
  const [ivHex, authTagHex, dataHex] = packed.split(":");
  if (!ivHex || !authTagHex || !dataHex) throw new Error("Malformed encrypted token payload");
  const decipher = createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]);
  return decrypted.toString("utf8");
}
