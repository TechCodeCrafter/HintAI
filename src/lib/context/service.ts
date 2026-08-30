import type { RepoPack } from "../repo/types.ts";
import { draftsFromPack, fingerprintPack, fingerprintsMatch, hydrateContext, packFromSources } from "./hydrate.ts";
import type { ContextRepository } from "./repository.ts";
import { createIndexedDbRepository } from "./storage/indexeddb.ts";
import type { ContextRecord } from "./types.ts";

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

/**
 * Persist a pruned pack as a Context + sources, then read it back and compare
 * file count, paths, and hashes before returning.
 */
export async function persistPackAsContext(
  pack: RepoPack,
  repo: ContextRepository = getContextRepository(),
): Promise<{ context: ContextRecord; pack: RepoPack }> {
  const context = await repo.createContext({
    name: pack.name,
    description: pack.description,
  });
  try {
    await repo.replaceSources(context.id, draftsFromPack(pack));
    const stored = await verifyPersistedPack(repo, context.id, pack);
    const ready = (await repo.getContext(context.id)) ?? { ...context, sourceCount: stored.files.length, status: "ready" as const };
    return { context: ready, pack: stored };
  } catch (error) {
    await repo.deleteContext(context.id).catch(() => undefined);
    throw error;
  }
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
