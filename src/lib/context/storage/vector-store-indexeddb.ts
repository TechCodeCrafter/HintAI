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

/** Rows read from the database in one request. */
const LOAD_BATCH = 2_000;

/** Rows held in memory before an index pass drops the ones it did not ask for. */
const MAX_HELD_ROWS = 80_000;

/**
 * Vectors in IndexedDB, with the rows this tab has read or written kept in
 * memory.
 *
 * A search needs the vector of every chunk in the space. Reading them from
 * IndexedDB on every question, and copying each into a plain array, cost more
 * than the search itself on a large space. Rows are now read once, kept as the
 * `Float32Array` they are stored as, and handed out as they are.
 *
 * What is in memory can be behind what another tab wrote. `hashes`, which an
 * index pass calls once, looks again for every id that had no row.
 */
export function createIndexedDbVectorStore(dbName = VECTOR_DATABASE_NAME): VectorStore {
  const db = new VectorDatabase(dbName);
  const held = new Map<string, VectorRow>();
  /** Ids that had no row when last looked up. */
  const absent = new Set<string>();

  const read = async (chunkIds: string[]): Promise<void> => {
    const missing = chunkIds.filter((id) => !held.has(id) && !absent.has(id));
    // A few thousand rows at a time: one read of a whole large space would
    // hold the page still while every row is turned back into an array.
    for (let at = 0; at < missing.length; at += LOAD_BATCH) {
      const part = missing.slice(at, at + LOAD_BATCH);
      const found = await db.embeddings.bulkGet(part);
      for (let i = 0; i < part.length; i += 1) {
        const row = found[i];
        if (row) held.set(row.chunkId, row);
        else absent.add(part[i]);
      }
    }
  };

  // One read at a time. A search that arrives while the space's vectors are
  // still being read ahead waits for that read and then finds them in memory,
  // instead of reading the same rows a second time.
  let reading: Promise<void> = Promise.resolve();
  const load = (chunkIds: string[]): Promise<void> => {
    const next = reading.then(() => read(chunkIds));
    reading = next.catch(() => undefined);
    return next;
  };

  return {
    async set(entries) {
      if (entries.length === 0) return;
      const rows = entries.map(toRow);
      await db.embeddings.bulkPut(rows);
      for (const row of rows) {
        held.set(row.chunkId, row);
        absent.delete(row.chunkId);
      }
    },
    async get(chunkIds) {
      await load(chunkIds);
      const out = new Map<string, ArrayLike<number>>();
      for (const id of chunkIds) {
        const row = held.get(id);
        if (row) out.set(id, row.embedding);
      }
      return out;
    },
    async delete(chunkIds) {
      if (chunkIds.length === 0) return;
      await db.embeddings.bulkDelete(chunkIds);
      for (const id of chunkIds) {
        held.delete(id);
        absent.add(id);
      }
    },
    async has(chunkId) {
      await load([chunkId]);
      return held.has(chunkId);
    },
    async isStale(chunkId, contentHash) {
      await load([chunkId]);
      const row = held.get(chunkId);
      return !row || row.contentHash !== contentHash;
    },
    async entries(chunkIds) {
      await load(chunkIds);
      const out = new Map<string, VectorEntry>();
      for (const id of chunkIds) {
        const row = held.get(id);
        if (row) out.set(id, fromRow(row));
      }
      return out;
    },
    async hashes(chunkIds) {
      // Another tab may have written vectors since these ids were found empty.
      for (const id of chunkIds) absent.delete(id);
      await load(chunkIds);
      if (held.size > MAX_HELD_ROWS) {
        // Spaces opened earlier in this tab. Keep what this pass asked for;
        // anything else is read again if a search needs it.
        const wanted = new Set(chunkIds);
        for (const id of held.keys()) if (!wanted.has(id)) held.delete(id);
        for (const id of absent) if (!wanted.has(id)) absent.delete(id);
      }
      const out = new Map<string, string>();
      for (const id of chunkIds) {
        const row = held.get(id);
        if (row) out.set(id, row.contentHash);
      }
      return out;
    },
  };
}

export { VectorDatabase };
