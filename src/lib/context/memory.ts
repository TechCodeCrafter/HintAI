import type { NormalizedDocument } from "../document/types.ts";
import { normalizedDocumentKey, sourceBlobKey } from "../document/types.ts";
import type { Chunk, IndexedChunk } from "../repo/types.ts";
import type { IndexedSourceRecord } from "./index-types.ts";
import { documentLedgerKey, indexedSourceKey, ledgerKey } from "./index-types.ts";
import { ContextNotFoundError, type ContextRepository } from "./repository.ts";
import { cachedDocumentIsCurrent } from "../document/usable.ts";
import { keepBlobHashes } from "../document/viewer/retain.ts";
import {
  applyParseToSources,
  commitStagedPdfs,
  contextStatusFor,
  mergeUpsert,
  referencedBlobHashes,
  textSourceFromDraft,
} from "./source-write.ts";
import { newContextRecord } from "./storage/schema.ts";
import type { ContextRecord, SourceDraft, StoredSource, UpsertDraft } from "./types.ts";
import { isPdfSource, isTextSource, metadataOnly } from "./types.ts";

export type MemoryRepository = ContextRepository & {
  corruptChunks(contextId: string, sourceId: string, payload: Chunk[] | "missing"): void;
  blobLoadCount: number;
  normalizedLoadCount: number;
};

/**
 * In-memory repository for tests. Same contract as IndexedDB, no Dexie.
 */
export function createMemoryRepository(): MemoryRepository {
  const contexts = new Map<string, ContextRecord>();
  const sources = new Map<string, StoredSource>();
  const indexed = new Map<string, IndexedSourceRecord>();
  const chunkRows = new Map<string, IndexedChunk[]>();
  const blobs = new Map<string, { contextId: string; sourceId: string; contentHash: string; blob: Blob }>();
  const documents = new Map<string, { contextId: string; document: NormalizedDocument }>();
  const repo: MemoryRepository = {
    blobLoadCount: 0,
    normalizedLoadCount: 0,
    async listContexts() {
      return [...contexts.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
    },

    async getContext(id) {
      return contexts.get(id) ?? null;
    },

    async createContext(input) {
      const record = newContextRecord(input);
      contexts.set(record.id, record);
      return record;
    },

    async replaceSources(contextId, drafts: SourceDraft[]) {
      const existing = contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      const now = Date.now();
      const previous = sourcesFor(contextId);
      const pdfs = previous.filter(isPdfSource);
      const byPath = new Map(previous.filter(isTextSource).map((row) => [row.path, row]));
      for (const [id, row] of sources) {
        if (row.contextId === contextId && isTextSource(row)) sources.delete(id);
      }
      const seen = new Set<string>();
      for (const draft of drafts) {
        const path = draft.path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
        if (!path || seen.has(path)) continue;
        seen.add(path);
        const row = await textSourceFromDraft(contextId, draft, byPath.get(path), now);
        sources.set(row.id, row);
      }
      for (const pdf of pdfs) sources.set(pdf.id, pdf);
      return finishWrite(contextId, existing, now);
    },

    async upsertSources(contextId, drafts: UpsertDraft[]) {
      const existing = contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      const now = Date.now();
      const current = sourcesFor(contextId);
      const merged = await mergeUpsert(contextId, drafts, current, now);
      if (merged.unchanged) return current;
      for (const [id, row] of sources) {
        if (row.contextId === contextId) sources.delete(id);
      }
      for (const row of merged.sources) sources.set(row.id, row);
      for (const blob of merged.blobsToWrite) {
        blobs.set(sourceBlobKey(blob.sourceId, blob.contentHash), blob);
      }
      const keep = keepBlobHashes(merged.hashesToKeep);
      for (const [key, row] of blobs) {
        if (row.contextId === contextId && !keep.has(key)) blobs.delete(key);
      }
      return finishWrite(contextId, existing, now);
    },

    async listSources(contextId) {
      return sourcesFor(contextId);
    },

    async countSources(contextId) {
      return sourcesFor(contextId).length;
    },

    async deleteContext(id) {
      dropIndexed(id);
      for (const [sourceId, row] of sources) {
        if (row.contextId === id) sources.delete(sourceId);
      }
      for (const [key, row] of blobs) {
        if (row.contextId === id) blobs.delete(key);
      }
      for (const [key, row] of documents) {
        if (row.contextId === id) documents.delete(key);
      }
      contexts.delete(id);
    },

    async listIndexed(contextId) {
      return [...indexed.values()].filter((row) => row.contextId === contextId);
    },

    async readIndexedChunks(contextId, sourceId, contentHash) {
      const key = contentHash
        ? documentLedgerKey(contextId, sourceId, contentHash)
        : indexedSourceKey(contextId, sourceId);
      if (!chunkRows.has(key)) return null;
      return chunkRows.get(key) ?? null;
    },

    async writeIndexed(record, next) {
      const key = ledgerKey(record);
      indexed.set(key, record);
      chunkRows.set(key, next);
    },

    async deleteIndexed(contextId, sourceIds) {
      dropIndexed(contextId, sourceIds);
    },

    async getSourceBlob(sourceId, contentHash) {
      repo.blobLoadCount += 1;
      return blobs.get(sourceBlobKey(sourceId, contentHash))?.blob ?? null;
    },

    async getNormalizedDocument(sourceId, contentHash) {
      repo.normalizedLoadCount += 1;
      let hash = contentHash;
      if (!hash) {
        const source = sources.get(sourceId);
        if (!source || !isPdfSource(source)) return null;
        hash = source.contentHash;
      }
      const document = documents.get(normalizedDocumentKey(sourceId, hash))?.document ?? null;
      return cachedDocumentIsCurrent(document) ? document : null;
    },

    async putNormalizedDocument(contextId, document) {
      documents.set(normalizedDocumentKey(document.sourceId, document.contentHash), { contextId, document });
    },

    async applyPdfParseResult(contextId, sourceId, contentHash, result) {
      const existing = contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      if (result.document) {
        documents.set(normalizedDocumentKey(result.document.sourceId, result.document.contentHash), {
          contextId,
          document: result.document,
        });
      }
      const now = Date.now();
      const next = applyParseToSources(sourcesFor(contextId), sourceId, contentHash, result, now);
      for (const [id, row] of sources) {
        if (row.contextId === contextId) sources.delete(id);
      }
      for (const row of next) sources.set(row.id, row);
      return finishWrite(contextId, existing, now).find((row) => row.id === sourceId) ?? null;
    },

    async beginContextActivation(contextId) {
      const existing = contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      const next = { ...existing, status: "indexing" as const, updatedAt: Date.now() };
      contexts.set(contextId, next);
      return next;
    },

    async completeContextActivation(contextId) {
      const existing = contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      const now = Date.now();
      const current = await readyStagedOrKeep(sourcesFor(contextId), now);
      const committed = commitStagedPdfs(current, now);
      for (const [id, row] of sources) {
        if (row.contextId === contextId) sources.delete(id);
      }
      for (const row of committed) sources.set(row.id, row);
      const keep = keepBlobHashes(referencedBlobHashes(committed));
      for (const [key, row] of blobs) {
        if (row.contextId === contextId && !keep.has(key)) blobs.delete(key);
      }
      for (const [key, row] of documents) {
        if (row.contextId === contextId && !keep.has(key)) documents.delete(key);
      }
      finishWrite(contextId, existing, now);
      const ready = contexts.get(contextId);
      if (!ready) throw new ContextNotFoundError(contextId);
      return ready;
    },

    corruptChunks(contextId, sourceId, payload) {
      const key = indexedSourceKey(contextId, sourceId);
      if (payload === "missing") {
        chunkRows.delete(key);
        return;
      }
      chunkRows.set(key, payload);
    },
  };

  function sourcesFor(contextId: string): StoredSource[] {
    return [...sources.values()]
      .filter((row) => row.contextId === contextId)
      .sort((a, b) => a.path.localeCompare(b.path))
      .map(metadataOnly);
  }

  function dropIndexed(contextId: string, sourceIds?: string[]) {
    for (const [key, row] of indexed) {
      if (row.contextId !== contextId) continue;
      if (sourceIds && !sourceIds.includes(row.sourceId)) continue;
      indexed.delete(key);
      chunkRows.delete(key);
    }
  }

  async function readyStagedOrKeep(rows: StoredSource[], now: number): Promise<StoredSource[]> {
    return Promise.all(
      rows.map(async (source) => {
        if (!isPdfSource(source) || !source.stagedContentHash || source.stagedReadiness !== "ready") {
          return source;
        }
        const document = documents.get(normalizedDocumentKey(source.id, source.stagedContentHash))?.document;
        if (cachedDocumentIsCurrent(document) && document.readiness === "ready") return source;
        const { stagedReadiness: _drop, ...rest } = source;
        return { ...rest, updatedAt: now };
      }),
    );
  }

  function finishWrite(contextId: string, existing: ContextRecord, now: number): StoredSource[] {
    const written = sourcesFor(contextId);
    contexts.set(contextId, {
      ...existing,
      sourceCount: written.length,
      status: contextStatusFor(written),
      updatedAt: now,
    });
    return written;
  }

  return repo;
}
