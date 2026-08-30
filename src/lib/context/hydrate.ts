import { preferredOpenFile, prunePack } from "../repo/folder.ts";
import type { IndexedChunk, RepoFile, RepoPack } from "../repo/types.ts";
import { buildChunks, packVocabulary } from "../search/retrieve.ts";
import { hashContent } from "./hash.ts";
import { ContextNotFoundError, type ContextRepository } from "./repository.ts";
import { isTextSource, type ContextRecord, type SourceDraft, type StoredSource } from "./types.ts";

export type HydratedRuntime = {
  pack: RepoPack;
  chunks: IndexedChunk[];
  vocab: ReturnType<typeof packVocabulary>;
  openFile: string | null;
  weak: boolean;
};

/**
 * Reconstruct a RepoPack from persisted sources. File chunks may be reused
 * from the index cache; they are never the source of truth.
 */
export function packFromSources(context: ContextRecord, sources: StoredSource[]): RepoPack {
  const files: RepoFile[] = sources.filter(isTextSource).map((source) => ({
    path: source.path,
    language: source.language ?? "txt",
    content: source.content,
  }));
  return {
    id: context.id,
    name: context.name,
    description: context.description ?? `Local folder · ${files.length} files`,
    files,
    commits: [],
  };
}

export function draftsFromPack(pack: RepoPack): SourceDraft[] {
  return pack.files.map((file) => ({
    path: file.path,
    language: file.language,
    content: file.content,
  }));
}

/**
 * Full rebuild used by the Northstar demo and tests. Persisted Contexts go
 * through `indexContext` so unchanged sources can reuse cached chunks.
 */
export function runtimeFromPack(pack: RepoPack): HydratedRuntime {
  const { pack: next, weak } = prunePack(pack);
  const use = next.files.length > 0 ? next : pack;
  const chunks = buildChunks(use);
  return {
    pack: use,
    chunks,
    vocab: packVocabulary(chunks),
    openFile: preferredOpenFile(use) ?? use.files[0]?.path ?? null,
    weak,
  };
}

export async function hydrateContext(repo: ContextRepository, id: string): Promise<RepoPack> {
  const context = await repo.getContext(id);
  if (!context) throw new ContextNotFoundError(id);
  const sources = await repo.listSources(id);
  return packFromSources(context, sources);
}

export type PackFingerprint = {
  fileCount: number;
  paths: string[];
  hashes: Record<string, string>;
};

export async function fingerprintPack(pack: RepoPack): Promise<PackFingerprint> {
  const hashes: Record<string, string> = {};
  const paths = pack.files.map((file) => file.path).sort();
  for (const file of pack.files) {
    hashes[file.path] = await hashContent(file.content);
  }
  return { fileCount: pack.files.length, paths, hashes };
}

export function fingerprintsMatch(a: PackFingerprint, b: PackFingerprint): boolean {
  if (a.fileCount !== b.fileCount) return false;
  if (a.paths.length !== b.paths.length) return false;
  for (let i = 0; i < a.paths.length; i += 1) {
    if (a.paths[i] !== b.paths[i]) return false;
  }
  for (const path of a.paths) {
    if (a.hashes[path] !== b.hashes[path]) return false;
  }
  return true;
}
