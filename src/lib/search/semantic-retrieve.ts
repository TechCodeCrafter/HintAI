import type { Hit, IndexedChunk } from "../repo/types.ts";
import { cosineSimilarity, embedText } from "./embedding.ts";
import { RETRIEVAL_WEIGHTS } from "./retrieval-weights.ts";
import type { VectorStore } from "./vector-store.ts";

/**
 * Rank chunks by cosine similarity to the question. Returns evidence
 * candidates only — it never composes a spoken line.
 */
export async function semanticRetrieve(
  query: string,
  chunks: IndexedChunk[],
  vectorStore: VectorStore,
  limit = 6,
): Promise<Hit[]> {
  const queryEmbedding = await embedText(query);
  const embeddingMap = await vectorStore.get(chunks.map((chunk) => chunk.id));
  const scored: Array<{ chunk: IndexedChunk; score: number }> = [];
  for (const chunk of chunks) {
    const emb = embeddingMap.get(chunk.id);
    if (!emb) continue;
    const similarity = cosineSimilarity(queryEmbedding, emb);
    if (similarity > RETRIEVAL_WEIGHTS.semanticFloor) {
      scored.push({ chunk, score: similarity });
    }
  }
  scored.sort((a, b) => b.score - a.score || a.chunk.id.localeCompare(b.chunk.id));
  return scored.slice(0, limit).map(({ chunk, score }) => ({
    ...chunk,
    score: score * RETRIEVAL_WEIGHTS.semanticScale,
    semanticScore: score * RETRIEVAL_WEIGHTS.semanticScale,
    lexicalScore: 0,
    signals: ["semantic"],
  }));
}
