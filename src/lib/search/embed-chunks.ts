import type { IndexedChunk } from "../repo/types.ts";
import { vectorCacheKey } from "./retrieval-scope.ts";
import { hashText } from "./evidence.ts";
import { embedBatch, embedText, embeddingTextFor } from "./embedding.ts";
import type { VectorStore } from "./vector-store.ts";

export function hashChunk(chunk: { text: string; path: string; heading?: string }): string {
  return hashText(embeddingTextFor(chunk.text, chunk.path, chunk.heading));
}

export type EmbedOptions = {
  /** Chunks encoded per call to the model. */
  batchSize?: number;
  /** Checked between batches. When true the pass stops and keeps what it wrote. */
  isCancelled?: () => boolean;
  /** Called between batches so the page can respond. Defaults to a zero-length timer. */
  pause?: () => Promise<void>;
};

export type EmbedResult = { wrote: number; reused: number };

/** Small enough that one encode call does not hold the page for long. */
export const EMBED_BATCH = 16;

async function chunksNeedingVectors(chunks: IndexedChunk[], store: VectorStore): Promise<IndexedChunk[]> {
  if (store.hashes) {
    // One read for the whole pass.
    const stored = await store.hashes(chunks.map((chunk) => vectorCacheKey(chunk)));
    return chunks.filter((chunk) => stored.get(vectorCacheKey(chunk)) !== hashChunk(chunk));
  }
  const needing: IndexedChunk[] = [];
  for (const chunk of chunks) {
    const key = vectorCacheKey(chunk);
    if (!(await store.has(key)) || (await store.isStale(key, hashChunk(chunk)))) needing.push(chunk);
  }
  return needing;
}

/**
 * Embed chunks that are missing or whose text hash no longer matches.
 * Failures are skipped — lexical retrieve still has the chunk.
 *
 * Works in small batches and writes each one as it finishes, so a pass that
 * is interrupted keeps what it did, and the next pass only does the rest.
 */
export async function embedIndexedChunks(
  chunks: IndexedChunk[],
  store: VectorStore,
  options: EmbedOptions = {},
): Promise<EmbedResult> {
  const needing = await chunksNeedingVectors(chunks, store);
  const reused = chunks.length - needing.length;
  if (needing.length === 0) return { wrote: 0, reused };

  const batchSize = Math.max(1, options.batchSize ?? EMBED_BATCH);
  const pause = options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  let wrote = 0;
  for (let at = 0; at < needing.length; at += batchSize) {
    if (at > 0) {
      await pause();
      if (options.isCancelled?.()) return { wrote, reused };
    }
    const batch = needing.slice(at, at + batchSize);
    let embeddings: number[][] = [];
    try {
      embeddings = await embedBatch(batch.map((chunk) => embeddingTextFor(chunk.text, chunk.path, chunk.heading)));
    } catch {
      // The model is not available. Trying the remaining batches now would
      // fail the same way; the next index pass tries them again.
      return { wrote, reused };
    }
    const written = batch
      .map((chunk, i) => ({
        chunkId: vectorCacheKey(chunk),
        embedding: embeddings[i] ?? [],
        contentHash: hashChunk(chunk),
      }))
      .filter((row) => row.embedding.length > 0);
    if (written.length > 0) await store.set(written);
    wrote += written.length;
  }
  return { wrote, reused };
}

/** One background queue per store, so two passes do not encode at the same time. */
const queues = new WeakMap<VectorStore, Promise<void>>();

/**
 * Queues an embedding pass and returns a promise for its end. The caller
 * decides how long to wait for it: the work goes on either way. Search works
 * without these vectors (the word and structure channels do not need them),
 * and each batch joins the ranking as it is written.
 */
export function embedInBackground(
  chunks: IndexedChunk[],
  store: VectorStore,
  options: EmbedOptions = {},
): Promise<void> {
  const previous = queues.get(store) ?? Promise.resolve();
  const next = previous
    .then(() => (options.isCancelled?.() ? undefined : embedIndexedChunks(chunks, store, options)))
    .then(
      () => undefined,
      () => undefined,
    );
  queues.set(store, next);
  return next;
}

/** Resolves when no background embedding is queued for this store. For tests. */
export function embeddingIdle(store: VectorStore): Promise<void> {
  return queues.get(store) ?? Promise.resolve();
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
      const text = embeddingTextFor(chunk.text, chunk.path, chunk.heading);
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
