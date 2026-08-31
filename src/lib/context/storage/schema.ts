import { CONTEXT_SCHEMA_VERSION, type ContextRecord, type StoredSource } from "../types.ts";

export const DATABASE_NAME = "meethint";
export const DATABASE_VERSION = 3;

export type ContextRow = ContextRecord;
export type SourceRow = StoredSource;

export const CONTEXT_INDEXES = "id, updatedAt, createdAt";
export const SOURCE_INDEXES = "id, contextId, [contextId+path], contentHash";
export const INDEXED_SOURCE_INDEXES = "id, contextId, sourceId, [contextId+sourceId]";
export const STORED_CHUNK_INDEXES = "id, contextId, sourceId, [contextId+sourceId]";
export const SOURCE_BLOB_INDEXES = "id, contextId, sourceId, contentHash, [sourceId+contentHash], [contextId+sourceId]";
export const NORMALIZED_DOCUMENT_INDEXES = "id, contextId, sourceId, contentHash, [sourceId+contentHash]";

export function newContextRecord(input: {
  name: string;
  description?: string;
  kind?: ContextRecord["kind"];
}): ContextRecord {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    name: input.name,
    description: input.description,
    kind: input.kind,
    createdAt: now,
    updatedAt: now,
    sourceCount: 0,
    status: "indexing",
    schemaVersion: CONTEXT_SCHEMA_VERSION,
  };
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "").replace(/^\/+/, "");
}
