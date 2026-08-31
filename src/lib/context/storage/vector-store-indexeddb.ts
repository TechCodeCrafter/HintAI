/**
 * Sidecar Dexie database for embeddings. Kept off the Context schema so a
 * vector-store bump cannot invalidate chunk cache rows or migration tests.
 * Search talks to VectorStore only — it does not import Dexie.
 */
import Dexie, { type Table } from "dexie";
import type { VectorEntry, VectorStore } from "../../search/vector-store.ts";

export const VECTOR_DATABASE_NAME = "meethint-vectors";

type VectorRow = {
  chunkId: string;
  embedding: Float32Array;
  contentHash: string;
};

class VectorDatabase extends Dexie {
  embeddings!: Table<VectorRow, string>;

  constructor(name = VECTOR_DATABASE_NAME) {
    super(name);
    this.version(1).stores({
      embeddings: "chunkId, contentHash",
    });
  }
}

function toRow(entry: VectorEntry): VectorRow {
  return {
    chunkId: entry.chunkId,
    embedding: Float32Array.from(entry.embedding),
    contentHash: entry.contentHash,
  };
}

function fromRow(row: VectorRow): VectorEntry {
  return {
    chunkId: row.chunkId,
    embedding: Array.from(row.embedding),
    contentHash: row.contentHash,
  };
}

export function createIndexedDbVectorStore(dbName = VECTOR_DATABASE_NAME): VectorStore {
  const db = new VectorDatabase(dbName);
  return {
    async set(entries) {
      if (entries.length === 0) return;
      await db.embeddings.bulkPut(entries.map(toRow));
    },
    async get(chunkIds) {
      const found = await db.embeddings.bulkGet(chunkIds);
      const out = new Map<string, number[]>();
      for (const row of found) {
        if (row) out.set(row.chunkId, Array.from(row.embedding));
      }
      return out;
    },
    async delete(chunkIds) {
      if (chunkIds.length === 0) return;
      await db.embeddings.bulkDelete(chunkIds);
    },
    async has(chunkId) {
      return (await db.embeddings.get(chunkId)) !== undefined;
    },
    async isStale(chunkId, contentHash) {
      const row = await db.embeddings.get(chunkId);
      return !row || row.contentHash !== contentHash;
    },
    async entries(chunkIds) {
      const found = await db.embeddings.bulkGet(chunkIds);
      const out = new Map<string, VectorEntry>();
      for (const row of found) {
        if (row) out.set(row.chunkId, fromRow(row));
      }
      return out;
    },
  };
}

export { VectorDatabase };
