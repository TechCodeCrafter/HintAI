import { defaultWorkspaceId, type WorkspaceId } from "../auth/workspace.ts";
import { WorkspaceScopeError } from "../auth/workspace.ts";
import type { IndexedChunk } from "../repo/types.ts";

/** Tenant + knowledge-space boundary for a retrieve() call. */
export type RetrievalScope = {
  workspaceId: WorkspaceId;
  contextId: string;
  /** When set, rank chunks from any listed context in the same workspace (Knowledge Space). */
  contextIds?: string[];
};

export type ScopedChunkMeta = {
  workspaceId?: WorkspaceId;
  contextId?: string;
};

export function tagChunksForScope(chunks: IndexedChunk[], scope: RetrievalScope): IndexedChunk[] {
  return chunks.map((chunk) => ({
    ...chunk,
    workspaceId: scope.workspaceId,
    contextId: scope.contextId,
  }));
}

function contextAllowed(meta: ScopedChunkMeta, scope: RetrievalScope): boolean {
  if (meta.contextId == null) return true;
  if (scope.contextIds?.length) return scope.contextIds.includes(meta.contextId);
  return meta.contextId === scope.contextId;
}

/** Drop chunks stamped for another workspace or context before ranking. */
export function filterChunksForScope(chunks: IndexedChunk[], scope: RetrievalScope): IndexedChunk[] {
  return chunks.filter((chunk) => {
    const meta = chunk as IndexedChunk & ScopedChunkMeta;
    if (meta.workspaceId != null && meta.workspaceId !== scope.workspaceId) return false;
    if (!contextAllowed(meta, scope)) return false;
    return true;
  });
}

/** Defense in depth: reject chunk sets that include foreign workspace/context stamps. */
export function assertRetrievalScope(chunks: IndexedChunk[], scope: RetrievalScope): void {
  for (const chunk of chunks) {
    const meta = chunk as IndexedChunk & ScopedChunkMeta;
    if (meta.workspaceId && meta.workspaceId !== scope.workspaceId) {
      throw new WorkspaceScopeError(
        `retrieve blocked: chunk ${chunk.id} belongs to workspace ${meta.workspaceId}`,
      );
    }
    if (meta.contextId && !contextAllowed(meta, scope)) {
      throw new WorkspaceScopeError(`retrieve blocked: chunk ${chunk.id} belongs to context ${meta.contextId}`);
    }
  }
}

/** Unit tests — scope aligned with bound account and context id. */
export function testRetrievalScope(contextId: string): RetrievalScope {
  return { workspaceId: defaultWorkspaceId(), contextId };
}

/** Vector cache key — scoped so embeddings never collide across spaces. */
export function vectorCacheKey(chunk: IndexedChunk): string {
  const meta = chunk as IndexedChunk & ScopedChunkMeta;
  if (meta.workspaceId && meta.contextId) {
    return `${meta.workspaceId}:${meta.contextId}:${chunk.id}`;
  }
  return chunk.id;
}
