import { test } from "node:test";
import assert from "node:assert";

process.env.TOKEN_ENCRYPTION_KEY = "1".repeat(64);
const { encryptToken, decryptToken } = await import("../infra/crypto.js");

test("crypto - encryptToken/decryptToken round-trip", () => {
  const plaintext = "EAABsbCS1234567890abcdef";
  const packed = encryptToken(plaintext);
  assert.notStrictEqual(packed, plaintext);
  assert.strictEqual(decryptToken(packed), plaintext);
});

test("crypto - decryptToken rejects a tampered payload", () => {
  const packed = encryptToken("some-secret-token");
  const [iv, authTag, data] = packed.split(":");
  const tampered = `${iv}:${authTag}:${data.slice(0, -2)}00`;
  assert.throws(() => decryptToken(tampered));
});
