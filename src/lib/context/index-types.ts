import type { IndexedChunk } from "../repo/types.ts";

export type IndexedSourceRecord = {
  /** `${contextId}:${sourceId}` */
  id: string;
  contextId: string;
  sourceId: string;
  contentHash: string;
  chunkerVersion: number;
  indexVersion: number;
  indexedAt: number;
  chunkCount: number;
  /** Present on PDF ledgers only. Absent / 0 on code rows. */
  parserVersion?: number;
  normalizerVersion?: number;
  documentChunkerVersion?: number;
};

export type StoredChunkRow = {
  /** `${contextId}:${sourceId}:${chunk.id}` */
  id: string;
  contextId: string;
  sourceId: string;
  ordinal: number;
  schemaVersion: number;
  chunk: IndexedChunk;
};

export type IndexStats = {
  reusedSourceCount: number;
  rebuiltSourceCount: number;
  deletedSourceCount: number;
  newSourceCount: number;
  reusedChunkCount: number;
  rebuiltChunkCount: number;
};

export type IndexTimings = {
  hydrateMs: number;
  hashCompareMs: number;
  cacheReadMs: number;
  chunkBuildMs: number;
  assembleMs: number;
  vocabMs: number;
  totalMs: number;
};

export type IndexReport = IndexStats & IndexTimings;

export function emptyIndexStats(): IndexStats {
  return {
    reusedSourceCount: 0,
    rebuiltSourceCount: 0,
    deletedSourceCount: 0,
    newSourceCount: 0,
    reusedChunkCount: 0,
    rebuiltChunkCount: 0,
  };
}

export function indexedSourceKey(contextId: string, sourceId: string): string {
  return `${contextId}:${sourceId}`;
}

export function storedChunkKey(contextId: string, sourceId: string, chunkId: string): string {
  return `${contextId}:${sourceId}:${chunkId}`;
}

export function documentLedgerKey(contextId: string, sourceId: string, contentHash: string): string {
  return `${contextId}:${sourceId}:${contentHash}`;
}

export function ledgerKey(record: IndexedSourceRecord): string {
  if (record.parserVersion || record.normalizerVersion || record.documentChunkerVersion) {
    return documentLedgerKey(record.contextId, record.sourceId, record.contentHash);
  }
  return indexedSourceKey(record.contextId, record.sourceId);
}
