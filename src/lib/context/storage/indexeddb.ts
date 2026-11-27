import Dexie, { type Table } from "dexie";
import { assertWorkspaceMatch, defaultWorkspaceId, withWorkspaceBackfill } from "../../auth/workspace.ts";
import type { NormalizedDocumentRow, SourceBlobRecord } from "../../document/types.ts";
import type { IndexedChunk } from "../../repo/types.ts";
import { normalizedDocumentKey, sourceBlobKey } from "../../document/types.ts";
import type { IndexedSourceRecord, SourceChunksRow, StoredChunkRow } from "../index-types.ts";
import { documentLedgerKey, indexedSourceKey, ledgerKey, storedChunkKey } from "../index-types.ts";
import { STORED_CHUNK_SCHEMA } from "../index-versions.ts";
import { ContextNotFoundError, type ContextRepository, type IndexedWrite } from "../repository.ts";
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
  DATABASE_VERSION,
  INDEXED_SOURCE_INDEXES,
  MEETING_INDEXES,
  newContextRecord,
  newSpaceRecord,
  normalizePath,
  SPACE_INDEXES,
  NORMALIZED_DOCUMENT_INDEXES,
  SOURCE_BLOB_INDEXES,
  SOURCE_CHUNK_INDEXES,
  SOURCE_INDEXES,
  STORED_CHUNK_INDEXES,
  type ContextRow,
  type SourceRow,
} from "./schema.ts";
import { upsertRepoBundle } from "../repo-bundle.ts";
import { displayNameFromPath, legacyRepoIdentity } from "../source-identity.ts";
import type { SpaceRecord } from "../space-types.ts";
import { SPACE_SCHEMA_VERSION } from "../space-types.ts";
import { CONTEXT_SCHEMA_VERSION } from "../types.ts";

class MeetHintDatabase extends Dexie {
  contexts!: Table<ContextRow, string>;
  sources!: Table<SourceRow, string>;
  indexedSources!: Table<IndexedSourceRecord, string>;
  storedChunks!: Table<StoredChunkRow, string>;
  sourceChunks!: Table<SourceChunksRow, string>;
  sourceBlobs!: Table<SourceBlobRecord, string>;
  normalizedDocuments!: Table<NormalizedDocumentRow, string>;
  meetings!: Table<MeetingRecord, string>;
  spaces!: Table<SpaceRecord, string>;

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
    this.version(5).stores({
      contexts: CONTEXT_INDEXES,
      sources: SOURCE_INDEXES,
      indexedSources: INDEXED_SOURCE_INDEXES,
      storedChunks: STORED_CHUNK_INDEXES,
      sourceBlobs: SOURCE_BLOB_INDEXES,
      normalizedDocuments: NORMALIZED_DOCUMENT_INDEXES,
      meetings: MEETING_INDEXES,
    }).upgrade(async (tx) => {
      const contexts = await tx.table("contexts").toArray();
      const names = new Map(contexts.map((row: ContextRow) => [row.id, row.name]));
      await tx.table("sources").toCollection().modify((row: SourceRow) => {
        backfillSourceIdentity(row, names.get(row.contextId) ?? "repo");
      });
      await tx.table("contexts").toCollection().modify((row: ContextRow) => {
        row.schemaVersion = CONTEXT_SCHEMA_VERSION;
      });
    });
    this.version(6).stores({
      contexts: CONTEXT_INDEXES,
      sources: SOURCE_INDEXES,
      indexedSources: INDEXED_SOURCE_INDEXES,
      storedChunks: STORED_CHUNK_INDEXES,
      sourceBlobs: SOURCE_BLOB_INDEXES,
      normalizedDocuments: NORMALIZED_DOCUMENT_INDEXES,
      meetings: MEETING_INDEXES,
      spaces: SPACE_INDEXES,
    }).upgrade(async (tx) => {
      const contexts = await tx.table("contexts").toArray();
      const spaces = tx.table("spaces");
      for (const ctx of contexts as ContextRow[]) {
        const id = ctx.id;
        const existing = await spaces.get(id);
        if (existing) continue;
        await spaces.add(
          newSpaceRecord({
            id,
            name: ctx.name,
            memberContextIds: [id],
            primaryContextId: id,
          }),
        );
      }
    });
    // 7: text chunks are stored a file to a row (`sourceChunks`). Nothing is
    // moved: chunks already in `storedChunks` are still read from there, and
    // a file goes to the new table the next time it is chunked.
    this.version(DATABASE_VERSION).stores({
      contexts: CONTEXT_INDEXES,
      sources: SOURCE_INDEXES,
      indexedSources: INDEXED_SOURCE_INDEXES,
      storedChunks: STORED_CHUNK_INDEXES,
      sourceChunks: SOURCE_CHUNK_INDEXES,
      sourceBlobs: SOURCE_BLOB_INDEXES,
      normalizedDocuments: NORMALIZED_DOCUMENT_INDEXES,
      meetings: MEETING_INDEXES,
      spaces: SPACE_INDEXES,
    });
  }
}

function backfillSourceIdentity(row: SourceRow, contextName: string): void {
  if (row.kind === "pdf") {
    row.sourceId = row.sourceId ?? row.id;
    row.sourceType = row.sourceType ?? "pdf";
    row.displayName = row.displayName ?? displayNameFromPath(row.path);
    row.pathPrefix = row.pathPrefix ?? "";
    return;
  }
  const identity = legacyRepoIdentity(row.contextId, contextName);
  row.sourceId = row.sourceId ?? identity.sourceId;
  row.sourceType = row.sourceType ?? identity.sourceType;
  row.displayName = row.displayName ?? identity.displayName;
  row.pathPrefix = row.pathPrefix ?? identity.pathPrefix;
}

function sortContexts(rows: ContextRecord[]): ContextRecord[] {
  return [...rows].sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

function sortSources(rows: StoredSource[], contextName = "repo"): StoredSource[] {
  return [...rows]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((row) => metadataOnly(withWorkspaceBackfill(normalizeStoredSource(row, contextName), defaultWorkspaceId())));
}

function normalizeStoredSource(row: StoredSource, contextName: string): StoredSource {
  if (isPdfSource(row)) {
    return {
      ...row,
      sourceId: row.sourceId ?? row.id,
      sourceType: row.sourceType ?? "pdf",
      displayName: row.displayName ?? displayNameFromPath(row.path),
      pathPrefix: row.pathPrefix ?? "",
    };
  }
  const identity = legacyRepoIdentity(row.contextId, contextName);
  return {
    ...row,
    sourceId: row.sourceId ?? identity.sourceId,
    sourceType: row.sourceType ?? identity.sourceType,
    displayName: row.displayName ?? identity.displayName,
    pathPrefix: row.pathPrefix ?? identity.pathPrefix,
  };
}

function normalizeContext(row: ContextRecord): ContextRecord {
  return withWorkspaceBackfill(row, defaultWorkspaceId());
}

function normalizeSpace(row: SpaceRecord): SpaceRecord {
  return withWorkspaceBackfill(
    {
      ...row,
      schemaVersion: row.schemaVersion ?? SPACE_SCHEMA_VERSION,
      memberContextIds: [...(row.memberContextIds ?? [])],
      primaryContextId: row.primaryContextId ?? row.memberContextIds?.[0] ?? row.id,
    },
    defaultWorkspaceId(),
  );
}

function sortSpaces(rows: SpaceRecord[]): SpaceRecord[] {
  return [...rows]
    .map(normalizeSpace)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.name.localeCompare(b.name));
}

function contextVisible(row: ContextRecord | undefined): ContextRecord | null {
  if (!row) return null;
  try {
    return normalizeContext(row);
  } catch {
    return null;
  }
}

async function draftsToTextSources(
  contextId: string,
  drafts: SourceDraft[],
  existing: StoredSource[],
  now: number,
  contextName = "repo",
): Promise<StoredSource[]> {
  const identity = legacyRepoIdentity(contextId, contextName);
  const byPath = new Map(existing.filter(isTextSource).map((row) => [row.path, row]));
  const seen = new Set<string>();
  const sources: StoredSource[] = [];
  for (const draft of drafts) {
    const path = normalizePath(draft.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    sources.push(await textSourceFromDraft(contextId, draft, byPath.get(path), now, identity));
  }
  return sources;
}

export function createIndexedDbRepository(dbName = DATABASE_NAME): ContextRepository {
  const db = new MeetHintDatabase(dbName);

  async function deleteIndexed(contextId: string, sourceIds?: string[]) {
    if (!sourceIds) {
      await db.indexedSources.where("contextId").equals(contextId).delete();
      await db.storedChunks.where("contextId").equals(contextId).delete();
      await db.sourceChunks.where("contextId").equals(contextId).delete();
      return;
    }
    if (sourceIds.length === 0) return;
    await db.sourceChunks.bulkDelete(sourceIds.map((sourceId) => indexedSourceKey(contextId, sourceId)));
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
    const ctx = await db.contexts.get(contextId);
    return sortSources(await db.sources.where("contextId").equals(contextId).toArray(), ctx?.name ?? "repo");
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

  /** A stored file's chunks, or null when the row is from a layout this build does not read. */
  function usableSourceChunks(row: SourceChunksRow): IndexedChunk[] | null {
    if (row.schemaVersion !== STORED_CHUNK_SCHEMA || !Array.isArray(row.chunks)) return null;
    return row.chunks;
  }

  /**
   * Stores ledger rows and their chunks in one transaction: all of them, or none.
   *
   * A text file's chunks are one row in `sourceChunks`. A PDF's stay a chunk
   * to a row in `storedChunks`, kept per content hash so a staged copy and
   * the live one can sit side by side.
   */
  async function writeIndexedEntries(entries: IndexedWrite[]) {
    if (entries.length === 0) return;
    await db.transaction("rw", db.contexts, db.indexedSources, db.storedChunks, db.sourceChunks, async () => {
      const workspaces = new Map<string, string | undefined>();
      for (const { record } of entries) {
        if (workspaces.has(record.contextId)) continue;
        const ctx = await db.contexts.get(record.contextId);
        if (!ctx) throw new ContextNotFoundError(record.contextId);
        const workspaceId = normalizeContext(ctx).workspaceId;
        assertWorkspaceMatch(workspaceId, "writeIndexed");
        workspaces.set(record.contextId, workspaceId);
      }
      const isDocument = (record: IndexedSourceRecord) => Boolean(record.parserVersion || record.documentChunkerVersion);
      const entryOf = new Map(entries.map((entry) => [`${entry.record.contextId}\u0000${entry.record.sourceId}`, entry]));
      // Rows this write replaces: a PDF's chunks for the same content, and a
      // text file's chunks from before they were kept a file to a row.
      const existing = await db.storedChunks
        .where("[contextId+sourceId]")
        .anyOf(entries.map(({ record }) => [record.contextId, record.sourceId]))
        .toArray();
      const stale: string[] = [];
      for (const row of existing) {
        const record = entryOf.get(`${row.contextId}\u0000${row.sourceId}`)?.record;
        if (!record) continue;
        const replace = isDocument(record)
          ? row.chunk.kind === "document" && row.chunk.contentHash === record.contentHash
          : row.chunk.kind !== "document";
        if (replace) stale.push(row.id);
      }
      if (stale.length > 0) await db.storedChunks.bulkDelete(stale);
      await db.indexedSources.bulkPut(
        entries.map(({ record }) => {
          const scoped = { ...record, workspaceId: workspaces.get(record.contextId) };
          return { ...scoped, id: ledgerKey(scoped) };
        }),
      );
      const documentRows: StoredChunkRow[] = [];
      const fileRows: SourceChunksRow[] = [];
      const emptied: string[] = [];
      for (const { record, chunks } of entries) {
        const workspaceId = workspaces.get(record.contextId);
        if (isDocument(record)) {
          chunks.forEach((chunk, ordinal) =>
            documentRows.push({
              id: storedChunkKey(record.contextId, record.sourceId, chunk.id),
              workspaceId,
              contextId: record.contextId,
              sourceId: record.sourceId,
              ordinal,
              schemaVersion: STORED_CHUNK_SCHEMA,
              chunk,
            }),
          );
        } else if (chunks.length === 0) {
          // No row: the ledger's count of zero is what says the file is current.
          emptied.push(indexedSourceKey(record.contextId, record.sourceId));
        } else {
          fileRows.push({
            id: indexedSourceKey(record.contextId, record.sourceId),
            workspaceId,
            contextId: record.contextId,
            sourceId: record.sourceId,
            schemaVersion: STORED_CHUNK_SCHEMA,
            chunks,
          });
        }
      }
      if (emptied.length > 0) await db.sourceChunks.bulkDelete(emptied);
      if (fileRows.length > 0) await db.sourceChunks.bulkPut(fileRows);
      if (documentRows.length > 0) await db.storedChunks.bulkAdd(documentRows);
    });
  }

  const contextStoreNames = [
    db.contexts,
    db.sources,
    db.indexedSources,
    db.storedChunks,
    db.sourceChunks,
    db.sourceBlobs,
    db.normalizedDocuments,
    db.spaces,
  ] as const;

  async function purgeContextData(contextId: string) {
    await deleteIndexed(contextId);
    await db.sourceBlobs.where("contextId").equals(contextId).delete();
    await db.normalizedDocuments.where("contextId").equals(contextId).delete();
    await db.sources.where("contextId").equals(contextId).delete();
    await db.contexts.delete(contextId);
  }

  async function detachContextFromSpaces(contextId: string) {
    const owned = await db.spaces.get(contextId);
    if (owned) {
      const space = normalizeSpace(owned);
      if (space.memberContextIds.length === 1 && space.memberContextIds[0] === contextId) {
        await db.spaces.delete(contextId);
        return;
      }
    }
    for (const row of await db.spaces.toArray()) {
      if (!row.memberContextIds.includes(contextId)) continue;
      const space = normalizeSpace(row);
      await db.spaces.put({
        ...space,
        memberContextIds: space.memberContextIds.filter((member) => member !== contextId),
        updatedAt: Date.now(),
      });
    }
  }

  return {
    async listContexts() {
      return sortContexts((await db.contexts.toArray()).map(normalizeContext));
    },

    async getContext(id) {
      const row = await db.contexts.get(id);
      return contextVisible(row);
    },

    async listSpaces() {
      return sortSpaces(await db.spaces.toArray());
    },

    async getSpace(id) {
      const row = await db.spaces.get(id);
      if (!row) return null;
      try {
        return normalizeSpace(row);
      } catch {
        return null;
      }
    },

    async createSpace(input) {
      const record = newSpaceRecord({
        id: input.id ?? crypto.randomUUID(),
        name: input.name,
        memberContextIds: input.memberContextIds,
        primaryContextId: input.primaryContextId,
      });
      assertWorkspaceMatch(record.workspaceId, "createSpace");
      await db.spaces.add(record);
      return record;
    },

    async createContext(input) {
      const record = newContextRecord(input);
      assertWorkspaceMatch(record.workspaceId, "createContext");
      await db.transaction("rw", db.contexts, db.spaces, async () => {
        await db.contexts.add(record);
        await db.spaces.add(
          newSpaceRecord({
            id: record.id,
            name: record.name,
            memberContextIds: [record.id],
            primaryContextId: record.id,
          }),
        );
      });
      return record;
    },

    async patchContext(id, patch) {
      const existing = contextVisible(await db.contexts.get(id));
      if (!existing) throw new ContextNotFoundError(id);
      assertWorkspaceMatch(existing.workspaceId, "patchContext");
      const next = { ...existing, ...patch, updatedAt: Date.now() };
      await db.contexts.put(next);
      return next;
    },

    async replaceSources(contextId, drafts) {
      const now = Date.now();
      const existing = await db.contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      const existingSources = await loadSources(contextId);
      const pdfs = existingSources.filter(isPdfSource);
      const texts = await draftsToTextSources(contextId, drafts, existingSources, now, existing.name);
      const sources = sortSources([...pdfs, ...texts], existing.name);
      await db.transaction("rw", db.contexts, db.sources, async () => {
        await writeContextSources(existing, sources, now);
      });
      return loadSources(contextId);
    },

    async upsertRepoBundle(contextId, bundle) {
      const existing = await db.contexts.get(contextId);
      if (!existing) throw new ContextNotFoundError(contextId);
      const now = Date.now();
      const current = await loadSources(contextId);
      const merged = await upsertRepoBundle(contextId, bundle, current, now);
      await db.transaction("rw", db.contexts, db.sources, db.indexedSources, db.storedChunks, db.sourceChunks, async () => {
        await writeContextSources(existing, merged.sources, now);
        if (merged.removedFileIds.length > 0) {
          await deleteIndexed(contextId, merged.removedFileIds);
        }
      });
      return loadSources(contextId);
    },

    async deleteSources(contextId, ids) {
      await db.transaction("rw", contextStoreNames, async () => {
        const existing = await db.contexts.get(contextId);
        if (!existing) throw new ContextNotFoundError(contextId);
        const rows = await db.sources.bulkGet(ids);
        const drop = rows.filter((row): row is SourceRow => row?.contextId === contextId).map((row) => row.id);
        if (drop.length === 0) return;
        await deleteIndexed(contextId, drop);
        for (const sourceId of drop) {
          await db.sourceBlobs.where("[contextId+sourceId]").equals([contextId, sourceId]).delete();
          const docs = await db.normalizedDocuments.where("sourceId").equals(sourceId).toArray();
          for (const doc of docs) if (doc.contextId === contextId) await db.normalizedDocuments.delete(doc.id);
        }
        await db.sources.bulkDelete(drop);
        const remaining = await db.sources.where("contextId").equals(contextId).toArray();
        await db.contexts.put({
          ...existing,
          sourceCount: remaining.length,
          status: contextStatusFor(remaining as StoredSource[]),
          updatedAt: Date.now(),
        });
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
      await db.transaction("rw", contextStoreNames, async () => {
        await purgeContextData(id);
        await detachContextFromSpaces(id);
      });
    },

    async deleteSpace(spaceId) {
      const row = await db.spaces.get(spaceId);
      if (!row) {
        await db.transaction("rw", contextStoreNames, async () => {
          await purgeContextData(spaceId);
          await detachContextFromSpaces(spaceId);
        });
        return;
      }
      const space = normalizeSpace(row);
      await db.transaction("rw", contextStoreNames, async () => {
        for (const contextId of space.memberContextIds) {
          await purgeContextData(contextId);
        }
        await db.spaces.delete(spaceId);
      });
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
        // A text file's chunks are one row, unless they were stored before that table existed.
        const held = await db.sourceChunks.get(indexedSourceKey(contextId, sourceId));
        if (held) return usableSourceChunks(held);
        const ledger = await db.indexedSources.get(ledgerId);
        return ledger?.chunkCount === 0 ? [] : null;
      }
      if (matched.some((row) => row.schemaVersion !== STORED_CHUNK_SCHEMA || !row.chunk)) return null;
      return matched
        .slice()
        .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))
        .map((row) => row.chunk);
    },

    async readIndexedChunksMany(contextId, sourceIds) {
      const out = new Map<string, IndexedChunk[] | null>();
      if (sourceIds.length === 0) return out;
      const held = await db.sourceChunks.bulkGet(sourceIds.map((sourceId) => indexedSourceKey(contextId, sourceId)));
      const missing: string[] = [];
      sourceIds.forEach((sourceId, i) => {
        const row = held[i];
        if (row) out.set(sourceId, usableSourceChunks(row));
        else missing.push(sourceId);
      });
      if (missing.length === 0) return out;
      // Not in the table of whole files: stored a chunk to a row, or has no chunks.
      const rows = await db.storedChunks
        .where("[contextId+sourceId]")
        .anyOf(missing.map((sourceId) => [contextId, sourceId]))
        .toArray();
      const bySource = new Map<string, StoredChunkRow[]>();
      for (const row of rows) {
        if (row.chunk?.kind === "document") continue;
        const list = bySource.get(row.sourceId);
        if (list) list.push(row);
        else bySource.set(row.sourceId, [row]);
      }
      // A source with no rows is current only when its ledger says it has no chunks.
      const empty = missing.filter((sourceId) => !bySource.has(sourceId));
      const ledgers = empty.length
        ? await db.indexedSources.bulkGet(empty.map((sourceId) => indexedSourceKey(contextId, sourceId)))
        : [];
      empty.forEach((sourceId, i) => out.set(sourceId, ledgers[i]?.chunkCount === 0 ? [] : null));
      for (const [sourceId, matched] of bySource) {
        out.set(
          sourceId,
          matched.some((row) => row.schemaVersion !== STORED_CHUNK_SCHEMA || !row.chunk)
            ? null
            : matched.sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0)).map((row) => row.chunk),
        );
      }
      return out;
    },

    async writeIndexed(record, chunks) {
      await writeIndexedEntries([{ record, chunks }]);
    },

    async writeIndexedBatch(entries) {
      await writeIndexedEntries(entries);
    },

    async deleteIndexed(contextId, sourceIds) {
      await db.transaction("rw", db.indexedSources, db.storedChunks, db.sourceChunks, async () => {
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
