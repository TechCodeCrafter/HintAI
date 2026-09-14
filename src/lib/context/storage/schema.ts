import { defaultWorkspaceId } from "../../auth/workspace.ts";
import { SPACE_SCHEMA_VERSION, type SpaceRecord } from "../space-types.ts";
import { CONTEXT_SCHEMA_VERSION, type ContextRecord, type StoredSource } from "../types.ts";

export const DATABASE_NAME = "meethint";
export const DATABASE_VERSION = 6;

export type ContextRow = ContextRecord;
export type SourceRow = StoredSource;

export const CONTEXT_INDEXES = "id, updatedAt, createdAt";
export const SPACE_INDEXES = "id, workspaceId, updatedAt";
export const SOURCE_INDEXES = "id, contextId, [contextId+path], contentHash";
export const INDEXED_SOURCE_INDEXES = "id, contextId, sourceId, [contextId+sourceId]";
export const STORED_CHUNK_INDEXES = "id, contextId, sourceId, [contextId+sourceId]";
export const SOURCE_BLOB_INDEXES = "id, contextId, sourceId, contentHash, [sourceId+contentHash], [contextId+sourceId]";
export const NORMALIZED_DOCUMENT_INDEXES = "id, contextId, sourceId, contentHash, [sourceId+contentHash]";
export const MEETING_INDEXES = "id, startedAt, endedAt, name";

export function newSpaceRecord(input: {
  id: string;
  name: string;
  memberContextIds: string[];
  primaryContextId: string;
}): SpaceRecord {
  const now = Date.now();
  return {
    id: input.id,
    workspaceId: defaultWorkspaceId(),
    name: input.name,
    memberContextIds: [...input.memberContextIds],
    primaryContextId: input.primaryContextId,
    createdAt: now,
    updatedAt: now,
    schemaVersion: SPACE_SCHEMA_VERSION,
  };
}

export function newContextRecord(input: {
  name: string;
  description?: string;
  kind?: ContextRecord["kind"];
}): ContextRecord {
  const now = Date.now();
  return {
    id: crypto.randomUUID(),
    workspaceId: defaultWorkspaceId(),
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
