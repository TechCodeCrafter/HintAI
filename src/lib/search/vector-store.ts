/**
 * chunkId → embedding. This does not replace stored chunks; it is a sidecar
 * the hybrid retriever may consult after lexical retrieve has already run.
 */

export type VectorEntry = {
  chunkId: string;
  embedding: number[];
  /** Of the embedded text, so an edit invalidates the vector without touching the chunk row. */
  contentHash: string;
};

export interface VectorStore {
  /** Store embeddings for chunks. */
  set(entries: VectorEntry[]): Promise<void>;
  /** Retrieve embeddings for given chunk ids. */
  get(chunkIds: string[]): Promise<Map<string, number[]>>;
  /** Delete embeddings for removed chunks. */
  delete(chunkIds: string[]): Promise<void>;
  /** Check if embeddings exist for a chunk id. */
  has(chunkId: string): Promise<boolean>;
  /** True when missing or the stored hash does not match. */
  isStale(chunkId: string, contentHash: string): Promise<boolean>;
  /** Hash + vector, for stale detection before re-embed. */
  entries(chunkIds: string[]): Promise<Map<string, VectorEntry>>;
}

export function createMemoryVectorStore(): VectorStore {
  const rows = new Map<string, VectorEntry>();
  return {
    async set(entries) {
      for (const entry of entries) {
        rows.set(entry.chunkId, {
          chunkId: entry.chunkId,
          embedding: entry.embedding.slice(),
          contentHash: entry.contentHash,
        });
      }
    },
    async get(chunkIds) {
      const out = new Map<string, number[]>();
      for (const id of chunkIds) {
        const row = rows.get(id);
        if (row) out.set(id, row.embedding.slice());
      }
      return out;
    },
    async delete(chunkIds) {
      for (const id of chunkIds) rows.delete(id);
    },
    async has(chunkId) {
      return rows.has(chunkId);
    },
    async isStale(chunkId, contentHash) {
      const row = rows.get(chunkId);
      return !row || row.contentHash !== contentHash;
    },
    async entries(chunkIds) {
      const out = new Map<string, VectorEntry>();
      for (const id of chunkIds) {
        const row = rows.get(id);
        if (row) {
          out.set(id, {
            chunkId: row.chunkId,
            embedding: row.embedding.slice(),
            contentHash: row.contentHash,
          });
        }
      }
      return out;
    },
  };
}
