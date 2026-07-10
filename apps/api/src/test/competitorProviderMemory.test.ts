import { test } from "node:test";
import assert from "node:assert";

delete process.env.OPENAI_API_KEY;

// Cache-busting dynamic import (same technique as researchProviders.test.ts /
// aiAgents.test.ts): infra/openaiClient.ts computes `openai` once at module-evaluation
// time, so CompetitorProvider (which reaches it transitively) needs a fresh module graph
// after deleting the env var above to see it unset.
const t = Date.now();
const { CompetitorProvider } = await import(`../research/providers/CompetitorProvider.js?t=${t}`);

test("CompetitorProvider - with no OPENAI_API_KEY, Research Memory is skipped entirely and the provider still degrades to its labeled fallback", async () => {
  const provider = new CompetitorProvider();
  const result = await provider.execute({ jobId: "job-1", workspaceId: "ws-1", businessId: "biz-1", url: "https://example.com" });

  // No live search, no embeddings possible without a key — this must be the same
  // no-key fallback shape CompetitorProvider had before Research Memory existed.
  assert.strictEqual(result.status, "partial");
  assert.strictEqual(result.data?.competitors[0]?.name, "Other providers in this category");
  assert.strictEqual(result.citations.length, 0);
});
