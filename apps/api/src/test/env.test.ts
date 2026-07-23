import { test } from "node:test";
import assert from "node:assert";

async function freshEnvModule() {
  const t = Date.now();
  return import(`../infra/env.js?t=${t}`);
}

test("env - JWT_SECRET falls back to a dev placeholder outside production", async () => {
  delete process.env.JWT_SECRET;
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "test";
  try {
    const { JWT_SECRET } = await freshEnvModule();
    assert.strictEqual(JWT_SECRET, "dev-secret-change-me");
  } finally {
    process.env.NODE_ENV = original;
  }
});

test("env - importing with NODE_ENV=production and no JWT_SECRET throws instead of falling back", async () => {
  delete process.env.JWT_SECRET;
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    await assert.rejects(() => freshEnvModule(), /JWT_SECRET must be set in production/);
  } finally {
    process.env.NODE_ENV = original;
  }
});

test("env - importing with NODE_ENV=production and JWT_SECRET set uses the real value", async () => {
  process.env.JWT_SECRET = "a-real-production-secret";
  process.env.CRM_JWT_SHARED_SECRET = "a-real-crm-secret";
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = "production";
  try {
    const { JWT_SECRET } = await freshEnvModule();
    assert.strictEqual(JWT_SECRET, "a-real-production-secret");
  } finally {
    process.env.NODE_ENV = original;
    delete process.env.JWT_SECRET;
    delete process.env.CRM_JWT_SHARED_SECRET;
  }
});
