import type { IndexedChunk } from "../repo/types.ts";
import { vectorCacheKey } from "./retrieval-scope.ts";
import { hashText } from "./evidence.ts";
import { embedBatch, embedText, embeddingTextFor } from "./embedding.ts";
import type { VectorStore } from "./vector-store.ts";

export function hashChunk(chunk: { text: string; path: string }): string {
  return hashText(embeddingTextFor(chunk.text, chunk.path));
}

/**
 * Embed chunks that are missing or whose text hash no longer matches.
 * Failures are skipped — lexical retrieve still has the chunk.
 */
export async function embedIndexedChunks(
  chunks: IndexedChunk[],
  store: VectorStore,
): Promise<{ wrote: number; reused: number }> {
  const needing: IndexedChunk[] = [];
  for (const chunk of chunks) {
    const hash = hashChunk(chunk);
    const key = vectorCacheKey(chunk);
    const hasEmbedding = await store.has(key);
    if (!hasEmbedding || (await store.isStale(key, hash))) needing.push(chunk);
  }
  const reused = chunks.length - needing.length;
  if (needing.length === 0) return { wrote: 0, reused };

  let embeddings: number[][] = [];
  try {
    embeddings = await embedBatch(needing.map((chunk) => embeddingTextFor(chunk.text, chunk.path)));
  } catch {
    return { wrote: 0, reused };
  }

  const written = needing
    .map((chunk, i) => ({
      chunkId: vectorCacheKey(chunk),
      embedding: embeddings[i] ?? [],
      contentHash: hashChunk(chunk),
    }))
    .filter((row) => row.embedding.length > 0);
  if (written.length > 0) await store.set(written);
  return { wrote: written.length, reused };
}

/** @deprecated Prefer embedIndexedChunks — kept for existing tests. */
export async function syncChunkEmbeddings(
  chunks: IndexedChunk[],
  store: VectorStore,
  embed: (text: string) => Promise<number[]> = embedText,
): Promise<{ wrote: number; reused: number }> {
  const ids = chunks.map((chunk) => vectorCacheKey(chunk));
  const existing = await store.entries(ids);
  const fresh: typeof chunks = [];
  let reused = 0;
  for (const chunk of chunks) {
    const hash = hashChunk(chunk);
    const row = existing.get(vectorCacheKey(chunk));
    if (row && row.contentHash === hash && row.embedding.length > 0) {
      reused += 1;
      continue;
    }
    fresh.push(chunk);
  }
  const written = [];
  for (const chunk of fresh) {
    try {
      const text = embeddingTextFor(chunk.text, chunk.path);
      const embedding = await embed(text);
      if (embedding.length === 0) continue;
      written.push({ chunkId: vectorCacheKey(chunk), embedding, contentHash: hashChunk(chunk) });
    } catch {
      // A failed encode must not drop the file from lexical search.
    }
  }
  if (written.length > 0) await store.set(written);
  return { wrote: written.length, reused };
}
