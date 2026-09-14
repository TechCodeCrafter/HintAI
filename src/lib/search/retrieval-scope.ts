import type { WorkspaceId } from "../auth/workspace.ts";
import { WorkspaceScopeError } from "../auth/workspace.ts";
import type { IndexedChunk } from "../repo/types.ts";

/** Tenant + knowledge-space boundary for a retrieve() call. */
export type RetrievalScope = {
  workspaceId: WorkspaceId;
  contextId: string;
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

/** Defense in depth: reject chunks stamped for another workspace or context. */
export function assertRetrievalScope(chunks: IndexedChunk[], scope: RetrievalScope): void {
  for (const chunk of chunks) {
    const meta = chunk as IndexedChunk & ScopedChunkMeta;
    if (meta.workspaceId && meta.workspaceId !== scope.workspaceId) {
      throw new WorkspaceScopeError(
        `retrieve blocked: chunk ${chunk.id} belongs to workspace ${meta.workspaceId}`,
      );
    }
    if (meta.contextId && meta.contextId !== scope.contextId) {
      throw new WorkspaceScopeError(`retrieve blocked: chunk ${chunk.id} belongs to context ${meta.contextId}`);
    }
  }
}

/** Vector cache key — scoped so embeddings never collide across spaces. */
export function vectorCacheKey(chunk: IndexedChunk): string {
  const meta = chunk as IndexedChunk & ScopedChunkMeta;
  if (meta.workspaceId && meta.contextId) {
    return `${meta.workspaceId}:${meta.contextId}:${chunk.id}`;
  }
  return chunk.id;
}
