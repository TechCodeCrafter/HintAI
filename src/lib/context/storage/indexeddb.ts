import Dexie, { type Table } from "dexie";
import type { NormalizedDocumentRow, SourceBlobRecord } from "../../document/types.ts";
import { normalizedDocumentKey, sourceBlobKey } from "../../document/types.ts";
import type { IndexedSourceRecord, StoredChunkRow } from "../index-types.ts";
import { documentLedgerKey, indexedSourceKey, ledgerKey, storedChunkKey } from "../index-types.ts";
import { STORED_CHUNK_SCHEMA } from "../index-versions.ts";
import { ContextNotFoundError, type ContextRepository } from "../repository.ts";
import { cachedDocumentIsCurrent } from "../../document/usable.ts";
import { keepBlobHashes } from "../../document/viewer/retain.ts";
import {
  applyParseToSources,
  commitStagedPdfs,
  contextStatusFor,
  referencedBlobHashes,
  textSourceFromDraft,
  mergeUpsert,
} from "../source-write.ts";
import type { ContextRecord, SourceDraft, StoredSource, UpsertDraft } from "../types.ts";
import { isPdfSource, isTextSource, metadataOnly } from "../types.ts";
import type { MeetingRecord } from "../../audit/types.ts";
import {
  CONTEXT_INDEXES,
  DATABASE_NAME,
  INDEXED_SOURCE_INDEXES,
  MEETING_INDEXES,
  newContextRecord,
  normalizePath,
  NORMALIZED_DOCUMENT_INDEXES,
  SOURCE_BLOB_INDEXES,
  SOURCE_INDEXES,
  STORED_CHUNK_INDEXES,
  type ContextRow,
  type SourceRow,
} from "./schema.ts";

class MeetHintDatabase extends Dexie {
  contexts!: Table<ContextRow, string>;
  sources!: Table<SourceRow, string>;
  indexedSources!: Table<IndexedSourceRecord, string>;
  storedChunks!: Table<StoredChunkRow, string>;
  sourceBlobs!: Table<SourceBlobRecord, string>;
  normalizedDocuments!: Table<NormalizedDocumentRow, string>;
  meetings!: Table<MeetingRecord, string>;

  constructor(name = DATABASE_NAME) {
    super(name);
    this.version(1).stores({
      contexts: CONTEXT_INDEXES,
      sources: SOURCE_INDEXES,
    });
    this.version(2).stores({
      contexts: CONTEXT_INDEXES,
      sources: SOURCE_INDEXES,
      indexedSources: INDEXED_SOURCE_INDEXES,
      storedChunks: STORED_CHUNK_INDEXES,
    });
    this.version(3).stores({
      contexts: CONTEXT_INDEXES,
      sources: SOURCE_INDEXES,
      indexedSources: INDEXED_SOURCE_INDEXES,
      storedChunks: STORED_CHUNK_INDEXES,
      sourceBlobs: SOURCE_BLOB_INDEXES,
      normalizedDocuments: NORMALIZED_DOCUMENT_INDEXES,
    });
    this.version(4).stores({
      contexts: CONTEXT_INDEXES,
      sources: SOURCE_INDEXES,
      indexedSources: INDEXED_SOURCE_INDEXES,
      storedChunks: STORED_CHUNK_INDEXES,
      sourceBlobs: SOURCE_BLOB_INDEXES,
      normalizedDocuments: NORMALIZED_DOCUMENT_INDEXES,
      meetings: MEETING_INDEXES,
    });
  }
}

function sortContexts(rows: ContextRecord[]): ContextRecord[] {
  return [...rows].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

function sortSources(rows: StoredSource[]): StoredSource[] {
  return [...rows].sort((a, b) => a.path.localeCompare(b.path)).map(metadataOnly);
}

async function draftsToTextSources(
  contextId: string,
  drafts: SourceDraft[],
  existing: StoredSource[],
  now: number,
): Promise<StoredSource[]> {
  const byPath = new Map(existing.filter(isTextSource).map((row) => [row.path, row]));
  const seen = new Set<string>();
  const sources: StoredSource[] = [];
  for (const draft of drafts) {
    const path = normalizePath(draft.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    sources.push(await textSourceFromDraft(contextId, draft, byPath.get(path), now));
  }
  return sources;
}

export function createIndexedDbRepository(dbName = DATABASE_NAME): ContextRepository {
  const db = new MeetHintDatabase(dbName);

  async function deleteIndexed(contextId: string, sourceIds?: string[]) {
    if (!sourceIds) {
      await db.indexedSources.where("contextId").equals(contextId).delete();
      await db.storedChunks.where("contextId").equals(contextId).delete();
      return;
    }
    if (sourceIds.length === 0) return;
    for (const sourceId of sourceIds) {
      const rows = await db.indexedSources.where("sourceId").equals(sourceId).toArray();
      for (const row of rows) {
        if (row.contextId !== contextId) continue;
        await db.indexedSources.delete(row.id);
      }
      await db.storedChunks.where("[contextId+sourceId]").equals([contextId, sourceId]).delete();
    }
  }

  async function loadSources(contextId: string): Promise<StoredSource[]> {
    return sortSources(await db.sources.where("contextId").equals(contextId).toArray());
  }

  async function writeContextSources(existing: ContextRecord, sources: StoredSource[], now: number, status?: ContextRecord["status"]) {
    await db.sources.where("contextId").equals(existing.id).delete();
    if (sources.length > 0) await db.sources.bulkAdd(sources);
    const sourceCount = await db.sources.where("contextId").equals(existing.id).count();
    await db.contexts.put({
      ...existing,
      sourceCount,
      status: status ?? contextStatusFor(sources),
      updatedAt: now,
    });
  }

  async function gcOrphans(contextId: string, keep: Set<string>) {
    const blobs = await db.sourceBlobs.where("contextId").equals(contextId).toArray();
    for (const row of blobs) {
      if (!keep.has(sourceBlobKey(row.sourceId, row.contentHash))) {
        await db.sourceBlobs.delete(row.id);
      }
    }
    const docs = await db.normalizedDocuments.where("contextId").equals(contextId).toArray();
    for (const row of docs) {
      if (!keep.has(normalizedDocumentKey(row.sourceId, row.contentHash))) {
        await db.normalizedDocuments.delete(row.id);
      }
    }
  }

  return {
    async listContexts() {
      return sortContexts(await db.contexts.toArray());
    },

    async getContext(id) {
      return (await db.contexts.get(id)) ?? null;
    },

    async createContext(input) {
      const record = newContextRecord(input);
      await db.contexts.add(record);
      return record;
    },

    async replaceSources(contextId, drafts) {
      const now = Date.now();
      const existingSources = await loadSources(contextId);
      const pdfs = existingSources.filter(isPdfSource);
      const texts = await draftsToTextSources(contextId, drafts, existingSources, now);
      const sources = sortSources([...pdfs, ...texts]);
      await db.transaction("rw", db.contexts, db.sources, async () => {
        const existing = await db.contexts.get(contextId);
        if (!existing) throw new ContextNotFoundError(contextId);
        await writeContextSources(existing, sources, now);
      });
      return loadSources(contextId);
    },

    async upsertSources(contextId, drafts: UpsertDraft[]) {
      const existing = await db.contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      const now = Date.now();
      const current = await loadSources(contextId);
      const merged = await mergeUpsert(contextId, drafts, current, now);
      if (merged.unchanged) return current;
      await db.transaction("rw", db.contexts, db.sources, db.sourceBlobs, db.normalizedDocuments, async () => {
        const live = await db.contexts.get(contextId);
        if (!live) throw new ContextNotFoundError(contextId);
        for (const blob of merged.blobsToWrite) {
          await db.sourceBlobs.put({
            id: sourceBlobKey(blob.sourceId, blob.contentHash),
            contextId: blob.contextId,
            sourceId: blob.sourceId,
            contentHash: blob.contentHash,
            blob: blob.blob,
          });
        }
        await writeContextSources(live, merged.sources, now);
        await gcOrphans(contextId, keepBlobHashes(merged.hashesToKeep));
      });
      return loadSources(contextId);
    },

    async listSources(contextId) {
      return loadSources(contextId);
    },

    async countSources(contextId) {
      return db.sources.where("contextId").equals(contextId).count();
    },

    async deleteContext(id) {
      await db.transaction(
        "rw",
        [
          db.contexts,
          db.sources,
          db.indexedSources,
          db.storedChunks,
          db.sourceBlobs,
          db.normalizedDocuments,
        ],
        async () => {
          await deleteIndexed(id);
          await db.sourceBlobs.where("contextId").equals(id).delete();
          await db.normalizedDocuments.where("contextId").equals(id).delete();
          await db.sources.where("contextId").equals(id).delete();
          await db.contexts.delete(id);
        },
      );
    },

    async listIndexed(contextId) {
      return db.indexedSources.where("contextId").equals(contextId).toArray();
    },

    async readIndexedChunks(contextId, sourceId, contentHash) {
      const ledgerId = contentHash
        ? documentLedgerKey(contextId, sourceId, contentHash)
        : indexedSourceKey(contextId, sourceId);
      const rows = await db.storedChunks.where("[contextId+sourceId]").equals([contextId, sourceId]).toArray();
      const matched = contentHash
        ? rows.filter((row) => row.chunk.kind !== "document" || row.chunk.contentHash === contentHash)
        : rows.filter((row) => row.chunk.kind !== "document");
      if (matched.length === 0) {
        const ledger = await db.indexedSources.get(ledgerId);
        return ledger?.chunkCount === 0 ? [] : null;
      }
      if (matched.some((row) => row.schemaVersion !== STORED_CHUNK_SCHEMA || !row.chunk)) return null;
      return matched
        .slice()
        .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
        .map((row) => row.chunk);
    },

    async writeIndexed(record, chunks) {
      await db.transaction("rw", db.indexedSources, db.storedChunks, async () => {
        const existing = await db.storedChunks.where("[contextId+sourceId]").equals([record.contextId, record.sourceId]).toArray();
        for (const row of existing) {
          const replace =
            record.parserVersion || record.documentChunkerVersion
              ? row.chunk.kind === "document" && row.chunk.contentHash === record.contentHash
              : row.chunk.kind !== "document";
          if (replace) await db.storedChunks.delete(row.id);
        }
        await db.indexedSources.put({ ...record, id: ledgerKey(record) });
        if (chunks.length === 0) return;
        await db.storedChunks.bulkAdd(
          chunks.map((chunk, ordinal) => ({
            id: storedChunkKey(record.contextId, record.sourceId, chunk.id),
            contextId: record.contextId,
            sourceId: record.sourceId,
            ordinal,
            schemaVersion: STORED_CHUNK_SCHEMA,
            chunk,
          })),
        );
      });
    },

    async deleteIndexed(contextId, sourceIds) {
      await db.transaction("rw", db.indexedSources, db.storedChunks, async () => {
        await deleteIndexed(contextId, sourceIds);
      });
    },

    async getSourceBlob(sourceId, contentHash) {
      const row = await db.sourceBlobs.get(sourceBlobKey(sourceId, contentHash));
      return row?.blob ?? null;
    },

    async getNormalizedDocument(sourceId, contentHash) {
      let hash = contentHash;
      if (!hash) {
        const source = await db.sources.get(sourceId);
        if (!source || !isPdfSource(source)) return null;
        hash = source.contentHash;
      }
      const row = await db.normalizedDocuments.get(normalizedDocumentKey(sourceId, hash));
      return cachedDocumentIsCurrent(row?.document) ? row.document : null;
    },

    async putNormalizedDocument(contextId, document) {
      await db.normalizedDocuments.put({
        id: normalizedDocumentKey(document.sourceId, document.contentHash),
        contextId,
        sourceId: document.sourceId,
        contentHash: document.contentHash,
        document,
      });
    },

    async applyPdfParseResult(contextId, sourceId, contentHash, result) {
      const existing = await db.contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      const now = Date.now();
      await db.transaction("rw", db.contexts, db.sources, db.normalizedDocuments, async () => {
        const live = await db.contexts.get(contextId);
        if (!live) throw new ContextNotFoundError(contextId);
        if (result.document) {
          await db.normalizedDocuments.put({
            id: normalizedDocumentKey(result.document.sourceId, result.document.contentHash),
            contextId,
            sourceId: result.document.sourceId,
            contentHash: result.document.contentHash,
            document: result.document,
          });
        }
        const current = sortSources(await db.sources.where("contextId").equals(contextId).toArray());
        const next = applyParseToSources(current, sourceId, contentHash, result, now);
        await writeContextSources(live, next, now);
      });
      const sources = await loadSources(contextId);
      return sources.find((row) => row.id === sourceId) ?? null;
    },

    async beginContextActivation(contextId) {
      const existing = await db.contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      const now = Date.now();
      const next = { ...existing, status: "indexing" as const, updatedAt: now };
      await db.contexts.put(next);
      return next;
    },

    async completeContextActivation(contextId) {
      const existing = await db.contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      const now = Date.now();
      const current = await loadSources(contextId);
      const gated: StoredSource[] = [];
      for (const source of current) {
        if (!isPdfSource(source) || !source.stagedContentHash || source.stagedReadiness !== "ready") {
          gated.push(source);
          continue;
        }
        const row = await db.normalizedDocuments.get(normalizedDocumentKey(source.id, source.stagedContentHash));
        if (cachedDocumentIsCurrent(row?.document) && row.document.readiness === "ready") {
          gated.push(source);
          continue;
        }
        const { stagedReadiness: _drop, ...rest } = source;
        gated.push({ ...rest, updatedAt: now });
      }
      const committed = commitStagedPdfs(gated, now);
      await db.transaction("rw", db.contexts, db.sources, db.sourceBlobs, db.normalizedDocuments, async () => {
        const live = await db.contexts.get(contextId);
        if (!live) throw new ContextNotFoundError(contextId);
        await writeContextSources(live, committed, now);
        await gcOrphans(contextId, keepBlobHashes(referencedBlobHashes(committed)));
      });
      return (await db.contexts.get(contextId)) ?? { ...existing, status: contextStatusFor(committed), updatedAt: now };
    },
  };
}

export { MeetHintDatabase };
