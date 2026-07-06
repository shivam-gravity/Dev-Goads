import { test, after } from "node:test";
import assert from "node:assert";
import { createHmac } from "node:crypto";

process.env.META_APP_SECRET = "test-app-secret";

const { isValidSignature } = await import(`../gateway/metaLeadWebhookRoutes.js?t=${Date.now()}`);
// metaLeadWebhookRoutes.js transitively imports infra/queue.js, which eagerly opens BOTH
// BullMQ queues' Redis connections at module load (creativeGenerationQueue too, even
// though this file only uses leadIngestionQueue) — with no Redis running, those connections
// retry forever and keep the event loop alive, hanging `node --test` after the last test
// finishes. Closing both here lets the process exit; it's a no-op for the assertions above,
// which never touch either queue.
const { leadIngestionQueue, creativeGenerationQueue } = await import("../infra/queue.js");
after(() => Promise.all([leadIngestionQueue.close(), creativeGenerationQueue.close()]));

function fakeRequest(body: string, signature?: string): any {
  return {
    rawBody: Buffer.from(body, "utf8"),
    header: (name: string) => (name.toLowerCase() === "x-hub-signature-256" ? signature : undefined),
  };
}

test("Meta lead webhook - accepts a correctly signed payload", () => {
  const body = JSON.stringify({ entry: [{ id: "page-1", changes: [] }] });
  const signature = `sha256=${createHmac("sha256", "test-app-secret").update(body).digest("hex")}`;
  assert.strictEqual(isValidSignature(fakeRequest(body, signature)), true);
});

test("Meta lead webhook - rejects a forged/unsigned payload", () => {
  const body = JSON.stringify({ entry: [{ id: "page-1", changes: [] }] });
  assert.strictEqual(isValidSignature(fakeRequest(body, "sha256=deadbeef")), false);
  assert.strictEqual(isValidSignature(fakeRequest(body, undefined)), false);
});

test("Meta lead webhook - rejects a payload signed with the wrong secret", () => {
  const body = JSON.stringify({ entry: [{ id: "page-1", changes: [] }] });
  const wrongSignature = `sha256=${createHmac("sha256", "someone-elses-secret").update(body).digest("hex")}`;
  assert.strictEqual(isValidSignature(fakeRequest(body, wrongSignature)), false);
});

test("Meta lead webhook - rejects when META_APP_SECRET is unset", async () => {
  delete process.env.META_APP_SECRET;
  const { isValidSignature: isValidSignatureNoSecret } = await import(`../gateway/metaLeadWebhookRoutes.js?t=${Date.now()}`);
  const body = JSON.stringify({ entry: [] });
  const signature = `sha256=${createHmac("sha256", "test-app-secret").update(body).digest("hex")}`;
  assert.strictEqual(isValidSignatureNoSecret(fakeRequest(body, signature)), false);
  process.env.META_APP_SECRET = "test-app-secret";
});
