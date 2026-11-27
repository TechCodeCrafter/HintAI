import { assertWorkspaceMatch, defaultWorkspaceId } from "../auth/workspace.ts";
import { indexContext, type IndexedRuntime, type IndexOptions, type IndexProgress } from "./chunk-index.ts";
import { tagChunksForScope } from "../search/retrieval-scope.ts";
import { packVocabulary } from "../search/retrieve.ts";
import { preferredOpenFile, prunePack, type SkippedFile } from "../repo/folder.ts";
import type { FileChange } from "../repo/git-history.ts";
import type { RepoFile, RepoPack } from "../repo/types.ts";
import { ContextNotFoundError, type ContextRepository } from "./repository.ts";
import { SpaceNotFoundError } from "./space-types.ts";
import type { StoredSource } from "./types.ts";
import { emptyIndexStats, type IndexReport } from "./index-types.ts";
import { mergeIndexSummaries, type IndexSummary } from "./index-summary.ts";

export type IndexedSpaceRuntime = IndexedRuntime & {
  memberContextIds: string[];
  allSources: StoredSource[];
  /** Files left out at load, as kept with each member context that still has sources. */
  notLoaded: SkippedFile[];
  /** Stored files a recent commit changed, as kept with each member context. */
  recentChanges: FileChange[];
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
  const summaries: IndexSummary[] = [];
  const notLoaded: SkippedFile[] = [];
  const recentChanges: FileChange[] = [];
  let weak = false;
  let openFile: string | null = null;
  const files: RepoFile[] = [];
  let excludePatterns: string[] | undefined;
  // Progress across member contexts is cumulative. The total is only known
  // up front when there is one context; with several it would have to be
  // guessed, so it is reported as unknown.
  const finished = { files: 0, chunks: 0 };
  let latest: IndexProgress = { filesDone: 0, filesTotal: 0, chunks: 0 };
  const onProgress = options.onProgress
    ? (progress: IndexProgress) => {
        latest = progress;
        options.onProgress?.({
          filesDone: finished.files + progress.filesDone,
          filesTotal: members.length === 1 ? progress.filesTotal : null,
          chunks: finished.chunks + progress.chunks,
        });
      }
    : undefined;

  for (const contextId of members) {
    if (options.isCancelled?.()) break;
    const context = await repo.getContext(contextId);
    if (!context) throw new ContextNotFoundError(contextId);
    if (!excludePatterns && context.excludePatterns?.length) {
      excludePatterns = context.excludePatterns;
    }
    const runtime = await indexContext(repo, contextId, { ...options, onProgress });
    finished.files += latest.filesDone;
    finished.chunks += latest.chunks;
    latest = { filesDone: 0, filesTotal: 0, chunks: 0 };
    if (runtime.cancelled) {
      return {
        ...runtime,
        memberContextIds: members,
        allSources,
        notLoaded,
        recentChanges,
      };
    }
    allChunks.push(...runtime.chunks);
    // Read once by the pass above. A few thousand files with their text are
    // not read from storage a second time to learn what was just read.
    const memberSources = runtime.sources ?? (await repo.listSources(contextId));
    allSources.push(...memberSources);
    if (memberSources.length > 0) notLoaded.push(...(context.notLoaded ?? []));
    if (memberSources.length > 0 && context.recentChanges?.length) {
      // Only for files that are still stored: a removed file has no chunks to rank.
      const stored = new Set(memberSources.map((source) => source.path));
      recentChanges.push(...context.recentChanges.filter((change) => stored.has(change.path)));
    }
    files.push(...runtime.pack.files);
    weak = weak || runtime.weak;
    openFile = openFile ?? runtime.openFile;
    reports.push(runtime.report);
    summaries.push(runtime.summary);
  }

  const primary = await repo.getContext(space.primaryContextId);

  const unionPack: RepoPack = {
    id: space.id,
    name: space.name,
    description: `Knowledge space · ${files.length} files across ${members.length} context(s)`,
    files,
    commits: [],
    excludePatterns: excludePatterns ?? primary?.excludePatterns,
  };
  const prefixByPath = new Map(allSources.map((source) => [source.path, source.pathPrefix]));
  const { pack: pruned, weak: pruneWeak } = prunePack(unionPack, (path) => prefixByPath.get(path) ?? "");
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
    // Per-context summaries are added up rather than recounted from the union,
    // so each context's own exclusions decide the reason shown for its files.
    summary: mergeIndexSummaries(summaries),
    cancelled: false,
    memberContextIds: members,
    allSources,
    notLoaded,
    recentChanges,
  };
}
