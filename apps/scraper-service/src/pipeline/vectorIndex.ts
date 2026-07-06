import { hashEmbedding, vectorStore } from "../../../api/src/infra/vectorStore.js";
import type { NormalizedProduct, SimilarProduct } from "../types.js";

const DEFAULT_TOP_K = 5;

function embeddingText(product: NormalizedProduct): string {
  return [product.name, product.category, product.description, ...product.keyFeatures].join(" ");
}

/**
 * Finds previously-imported products most similar to this one, then indexes
 * this one for future lookups. Queries before upserting so the current
 * product doesn't match against itself. Runs in-process (see vectorStore.ts) —
 * this service's own import history only, not shared across processes yet.
 */
export async function indexAndFindSimilar(url: string, product: NormalizedProduct, topK = DEFAULT_TOP_K): Promise<SimilarProduct[]> {
  const embedding = hashEmbedding(embeddingText(product));

  const matches = await vectorStore.query(embedding, topK);
  await vectorStore.upsert([{ id: url, embedding, metadata: { url, name: product.name, category: product.category } }]);

  return matches.map((m) => ({
    url: m.id,
    name: typeof m.metadata?.name === "string" ? m.metadata.name : m.id,
    category: typeof m.metadata?.category === "string" ? m.metadata.category : "General",
    score: m.score,
  }));
}
