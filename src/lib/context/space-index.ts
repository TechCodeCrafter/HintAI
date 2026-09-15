import { assertWorkspaceMatch, defaultWorkspaceId } from "../auth/workspace.ts";
import { packFromSources } from "./hydrate.ts";
import { indexContext, type IndexedRuntime, type IndexOptions } from "./chunk-index.ts";
import { tagChunksForScope } from "../search/retrieval-scope.ts";
import { packVocabulary } from "../search/retrieve.ts";
import { preferredOpenFile, prunePack } from "../repo/folder.ts";
import type { RepoFile, RepoPack } from "../repo/types.ts";
import { ContextNotFoundError, type ContextRepository } from "./repository.ts";
import { SpaceNotFoundError } from "./space-types.ts";
import type { StoredSource } from "./types.ts";
import { emptyIndexStats, type IndexReport } from "./index-types.ts";

export type IndexedSpaceRuntime = IndexedRuntime & {
  memberContextIds: string[];
  allSources: StoredSource[];
};

function mergeReports(reports: IndexReport[]): IndexReport {
  const merged: IndexReport = {
    ...emptyIndexStats(),
    hydrateMs: 0,
    hashCompareMs: 0,
    cacheReadMs: 0,
    chunkBuildMs: 0,
    assembleMs: 0,
    vocabMs: 0,
    embedMs: 0,
    totalMs: 0,
  };
  for (const report of reports) {
    merged.reusedSourceCount += report.reusedSourceCount;
    merged.rebuiltSourceCount += report.rebuiltSourceCount;
    merged.deletedSourceCount += report.deletedSourceCount;
    merged.newSourceCount += report.newSourceCount;
    merged.reusedChunkCount += report.reusedChunkCount;
    merged.rebuiltChunkCount += report.rebuiltChunkCount;
    merged.hydrateMs += report.hydrateMs;
    merged.hashCompareMs += report.hashCompareMs;
    merged.cacheReadMs += report.cacheReadMs;
    merged.chunkBuildMs += report.chunkBuildMs;
    merged.assembleMs += report.assembleMs;
    merged.vocabMs += report.vocabMs;
    merged.embedMs += report.embedMs;
    merged.totalMs += report.totalMs;
  }
  return merged;
}

/**
 * Index every member context in a Knowledge Space and union chunks for search.
 */
export async function indexSpace(
  repo: ContextRepository,
  spaceId: string,
  options: IndexOptions = {},
): Promise<IndexedSpaceRuntime> {
  const space = await repo.getSpace(spaceId);
  if (!space) throw new SpaceNotFoundError(spaceId);
  assertWorkspaceMatch(space.workspaceId, "indexSpace");

  const members = [...new Set(space.memberContextIds)];
  if (members.length === 0) throw new SpaceNotFoundError(spaceId);

  const allChunks: IndexedRuntime["chunks"] = [];
  const allSources: StoredSource[] = [];
  const reports: IndexReport[] = [];
  let weak = false;
  let openFile: string | null = null;
  const files: RepoFile[] = [];
  let excludePatterns: string[] | undefined;

  for (const contextId of members) {
    if (options.isCancelled?.()) break;
    const context = await repo.getContext(contextId);
    if (!context) throw new ContextNotFoundError(contextId);
    if (!excludePatterns && context.excludePatterns?.length) {
      excludePatterns = context.excludePatterns;
    }
    const runtime = await indexContext(repo, contextId, options);
    if (runtime.cancelled) {
      return {
        ...runtime,
        memberContextIds: members,
        allSources,
      };
    }
    allChunks.push(...runtime.chunks);
    allSources.push(...(await repo.listSources(contextId)));
    files.push(...runtime.pack.files);
    weak = weak || runtime.weak;
    openFile = openFile ?? runtime.openFile;
    reports.push(runtime.report);
  }

  const primary = await repo.getContext(space.primaryContextId);
  const primarySources = primary ? await repo.listSources(primary.id) : allSources;
  const primaryPack = primary
    ? packFromSources(primary, primarySources)
    : {
        id: space.id,
        name: space.name,
        description: "",
        files: [],
        commits: [],
      };

  const unionPack: RepoPack = {
    id: space.id,
    name: space.name,
    description: `Knowledge space · ${files.length} files across ${members.length} context(s)`,
    files,
    commits: [],
    excludePatterns: excludePatterns ?? primaryPack.excludePatterns,
  };
  const { pack: pruned, weak: pruneWeak } = prunePack(unionPack);
  const use = pruned.files.length > 0 ? pruned : unionPack;
  const scopedChunks = tagChunksForScope(allChunks, {
    workspaceId: space.workspaceId ?? defaultWorkspaceId(),
    spaceId: space.id,
    contextId: space.primaryContextId,
    contextIds: members,
  });
  const vocab = packVocabulary(scopedChunks);
  const report = mergeReports(reports);

  return {
    pack: use,
    chunks: scopedChunks,
    vocab,
    openFile: openFile ?? preferredOpenFile(use) ?? use.files[0]?.path ?? null,
    weak: weak || pruneWeak,
    report,
    cancelled: false,
    memberContextIds: members,
    allSources,
  };
}
