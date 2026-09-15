import { defaultWorkspaceId, type WorkspaceId } from "../auth/workspace.ts";
import { WorkspaceScopeError } from "../auth/workspace.ts";
import type { IndexedChunk } from "../repo/types.ts";
import { isFileChunk } from "../repo/types.ts";

/** Tenant + knowledge-space boundary for a retrieve() call. */
export type RetrievalScope = {
  workspaceId: WorkspaceId;
  /** Active Knowledge Space id. */
  spaceId: string;
  /** Primary member context (legacy compat). */
  contextId: string;
  /** Authorized member contexts — filter before ranking when set. */
  contextIds?: string[];
  /** Authorized ingest units (repo bundles / PDFs) — filter before ranking when set. */
  sourceIds?: string[];
};

export type ScopedChunkMeta = {
  workspaceId?: WorkspaceId;
  spaceId?: string;
  contextId?: string;
  sourceId?: string;
};

export function tagChunksForScope(chunks: IndexedChunk[], scope: RetrievalScope): IndexedChunk[] {
  return chunks.map((chunk) => {
    const meta = chunk as IndexedChunk & ScopedChunkMeta;
    return {
      ...chunk,
      workspaceId: scope.workspaceId,
      spaceId: scope.spaceId,
      contextId: meta.contextId ?? scope.contextId,
    };
  });
}

function contextAllowed(meta: ScopedChunkMeta, scope: RetrievalScope): boolean {
  if (meta.contextId == null) return true;
  if (scope.contextIds?.length) return scope.contextIds.includes(meta.contextId);
  return meta.contextId === scope.contextId;
}

function sourceAllowed(chunk: IndexedChunk, scope: RetrievalScope): boolean {
  if (!scope.sourceIds?.length) return true;
  const meta = chunk as IndexedChunk & ScopedChunkMeta;
  const sourceId =
    meta.sourceId ?? (isFileChunk(chunk) ? chunk.sourceId : chunk.kind === "document" ? chunk.sourceId : undefined);
  if (!sourceId) return false;
  return scope.sourceIds.includes(sourceId);
}

/** Drop chunks outside workspace / space membership / authorized sources before ranking. */
export function filterChunksForScope(chunks: IndexedChunk[], scope: RetrievalScope): IndexedChunk[] {
  return chunks.filter((chunk) => {
    const meta = chunk as IndexedChunk & ScopedChunkMeta;
    if (meta.workspaceId != null && meta.workspaceId !== scope.workspaceId) return false;
    if (meta.spaceId != null && meta.spaceId !== scope.spaceId) return false;
    if (!contextAllowed(meta, scope)) return false;
    if (!sourceAllowed(chunk, scope)) return false;
    return true;
  });
}

/** Defense in depth: reject chunk sets that include foreign workspace/space/context stamps. */
export function assertRetrievalScope(chunks: IndexedChunk[], scope: RetrievalScope): void {
  for (const chunk of chunks) {
    const meta = chunk as IndexedChunk & ScopedChunkMeta;
    if (meta.workspaceId && meta.workspaceId !== scope.workspaceId) {
      throw new WorkspaceScopeError(
        `retrieve blocked: chunk ${chunk.id} belongs to workspace ${meta.workspaceId}`,
      );
    }
    if (meta.spaceId && meta.spaceId !== scope.spaceId) {
      throw new WorkspaceScopeError(
        `retrieve blocked: chunk ${chunk.id} belongs to space ${meta.spaceId}`,
      );
    }
    if (meta.contextId && !contextAllowed(meta, scope)) {
      throw new WorkspaceScopeError(`retrieve blocked: chunk ${chunk.id} belongs to context ${meta.contextId}`);
    }
    if (!sourceAllowed(chunk, scope)) {
      throw new WorkspaceScopeError(`retrieve blocked: chunk ${chunk.id} source not authorized for space`);
    }
  }
}

/** Unit tests — scope aligned with bound account and context id. */
export function testRetrievalScope(contextId: string, spaceId = contextId): RetrievalScope {
  return {
    workspaceId: defaultWorkspaceId(),
    spaceId,
    contextId,
    contextIds: [contextId],
  };
}

/** Vector cache key — scoped so embeddings never collide across spaces. */
export function vectorCacheKey(chunk: IndexedChunk): string {
  const meta = chunk as IndexedChunk & ScopedChunkMeta;
  if (meta.workspaceId && meta.contextId) {
    return `${meta.workspaceId}:${meta.contextId}:${chunk.id}`;
  }
  return chunk.id;
}
