import { currentWorkspaceId, defaultWorkspaceId, requireWorkspaceId } from "../auth/workspace.ts";
import type { SpaceRecord } from "../context/space-types.ts";
import type { StoredSource } from "../context/types.ts";
import { isPdfSource, isTextSource } from "../context/types.ts";
import type { Hit, IndexedChunk, RepoPack } from "../repo/types.ts";
import { expandRetrievalQuery } from "./spoken.ts";
import { retrieveHits, retrieveHitsOptionsForPack } from "./retrieve.ts";
import type { RetrievalScope } from "./retrieval-scope.ts";
import type { VectorStore } from "./vector-store.ts";

export type SpaceSearchState = {
  activeSpaceId: string | null;
  activeContextId: string | null;
  memberContextIds: string[];
  authorizedSourceIds: string[];
};

/** Collect stable ingest-unit ids from persisted sources. */
export function authorizedSourceIdsFrom(sources: StoredSource[]): string[] {
  const ids = new Set<string>();
  for (const row of sources) {
    if (isTextSource(row) || isPdfSource(row)) {
      ids.add(row.sourceId ?? row.id);
    }
  }
  return [...ids];
}

export function memberContextIdsFromSpace(space: SpaceRecord): string[] {
  return [...new Set(space.memberContextIds.filter(Boolean))];
}

/**
 * Production retrieval boundary for store.search().
 * Filters by workspace, then space members, then authorized source ids.
 */
export function buildSearchRetrievalScope(
  state: SpaceSearchState,
  workspaceId: string = currentWorkspaceId() ?? defaultWorkspaceId(),
): RetrievalScope {
  const spaceId = state.activeSpaceId ?? state.activeContextId;
  if (!spaceId) {
    throw new Error("buildSearchRetrievalScope: no active knowledge space");
  }
  const members =
    state.memberContextIds.length > 0 ? [...new Set(state.memberContextIds)] : [spaceId];
  const primaryContextId = state.activeContextId ?? members[0] ?? spaceId;
  return {
    workspaceId,
    spaceId,
    contextId: primaryContextId,
    contextIds: members,
    sourceIds:
      state.authorizedSourceIds.length > 0
        ? [...new Set(state.authorizedSourceIds)]
        : undefined,
  };
}

/** Defense in depth: space record must belong to the bound workspace. */
export function assertSpaceWorkspace(space: SpaceRecord, workspaceId: string = requireWorkspaceId()): void {
  if (space.workspaceId && space.workspaceId !== workspaceId) {
    throw new Error(
      `Knowledge space ${space.id} belongs to workspace ${space.workspaceId}, not ${workspaceId}`,
    );
  }
}

/** Shared retrieval entry used by store.search() — space-scoped, filter-before-rank. */
export async function runSpaceScopedRetrieval(input: {
  query: string;
  previousQuestion?: string | null;
  chunks: IndexedChunk[];
  pack: Pick<RepoPack, "excludePatterns">;
  spaceState: SpaceSearchState;
  workspaceId?: string;
  vectorStore?: VectorStore | null;
  limit?: number;
  hybrid?: boolean;
}): Promise<Hit[]> {
  const workspaceId = input.workspaceId ?? currentWorkspaceId() ?? defaultWorkspaceId();
  const scope = buildSearchRetrievalScope(input.spaceState, workspaceId);
  return retrieveHits(
    expandRetrievalQuery(input.query, input.previousQuestion),
    input.chunks,
    {
      ...retrieveHitsOptionsForPack(input.pack, scope, {
        limit: input.limit ?? 6,
        vectorStore: input.vectorStore,
      }),
      hybrid: input.hybrid,
    },
  );
}
