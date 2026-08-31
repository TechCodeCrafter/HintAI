import type { RepoPack } from "../repo/types.ts";
import { draftsFromPack, fingerprintPack, fingerprintsMatch, hydrateContext, packFromSources } from "./hydrate.ts";
import { ContextNotFoundError, type ContextRepository } from "./repository.ts";
import { createIndexedDbRepository } from "./storage/indexeddb.ts";
import type { ContextKind, ContextRecord } from "./types.ts";
import { isPdfSource, isTextSource } from "./types.ts";

let repository: ContextRepository | null = null;

export function getContextRepository(): ContextRepository {
  repository ??= createIndexedDbRepository();
  return repository;
}

/** Tests inject a memory repository so they never touch Dexie. */
export function setContextRepository(next: ContextRepository | null): void {
  repository = next;
}

export async function listStoredContexts(repo: ContextRepository = getContextRepository()): Promise<ContextRecord[]> {
  return repo.listContexts();
}

export type PersistPackOptions = {
  /** Attach to an existing context instead of creating one. */
  contextId?: string;
  kind?: ContextKind;
};

export type ContextSummary = {
  context: ContextRecord;
  fileCount: number;
  pdfCount: number;
  chunkCount: number;
  symbolCount: number;
};

/**
 * Persist a pruned pack as a Context + sources, then read it back and compare
 * file count, paths, and hashes before returning.
 */
export async function persistPackAsContext(
  pack: RepoPack,
  repo: ContextRepository = getContextRepository(),
  options?: PersistPackOptions,
): Promise<{ context: ContextRecord; pack: RepoPack }> {
  const existing = options?.contextId ? await repo.getContext(options.contextId) : null;
  if (options?.contextId && !existing) throw new ContextNotFoundError(options.contextId);
  const created = existing
    ? null
    : await repo.createContext({
        name: pack.name,
        description: pack.description,
        kind: options?.kind,
      });
  const context = existing ?? created;
  if (!context) throw new Error("Could not create a context");
  try {
    await repo.replaceSources(context.id, draftsFromPack(pack));
    const stored = await verifyPersistedPack(repo, context.id, pack);
    const ready = (await repo.getContext(context.id)) ?? { ...context, sourceCount: stored.files.length, status: "ready" as const };
    return { context: ready, pack: stored };
  } catch (error) {
    if (created) await repo.deleteContext(created.id).catch(() => undefined);
    throw error;
  }
}

export async function listContextSummaries(
  repo: ContextRepository = getContextRepository(),
): Promise<ContextSummary[]> {
  const contexts = await repo.listContexts();
  const summaries: ContextSummary[] = [];
  for (const context of contexts) {
    const sources = await repo.listSources(context.id);
    const ledgers = await repo.listIndexed(context.id);
    let symbolCount = 0;
    for (const ledger of ledgers) {
      const chunks = await repo.readIndexedChunks(context.id, ledger.sourceId, ledger.contentHash);
      if (!chunks) continue;
      for (const chunk of chunks) {
        if ("symbol" in chunk && chunk.symbol) symbolCount += 1;
      }
    }
    summaries.push({
      context,
      fileCount: sources.filter(isTextSource).length,
      pdfCount: sources.filter(isPdfSource).length,
      chunkCount: ledgers.reduce((sum, row) => sum + row.chunkCount, 0),
      symbolCount,
    });
  }
  return summaries;
}

export async function verifyPersistedPack(
  repo: ContextRepository,
  contextId: string,
  expected: RepoPack,
): Promise<RepoPack> {
  const context = await repo.getContext(contextId);
  if (!context) throw new Error("Context disappeared after write");
  const sources = await repo.listSources(contextId);
  const reconstructed = packFromSources(context, sources);
  const written = await fingerprintPack(expected);
  const readBack = await fingerprintPack(reconstructed);
  if (!fingerprintsMatch(written, readBack)) {
    throw new Error("Persisted sources did not match the pack that was written");
  }
  const counted = await repo.countSources(contextId);
  if (counted !== sources.length || context.sourceCount !== counted) {
    throw new Error("Context sourceCount is out of sync with stored sources");
  }
  return reconstructed;
}

export async function loadPersistedPack(
  contextId: string,
  repo: ContextRepository = getContextRepository(),
): Promise<RepoPack> {
  return hydrateContext(repo, contextId);
}
