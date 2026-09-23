import type { IndexedChunk } from "../repo/types.ts";
import type { VectorStore } from "../search/vector-store.ts";
import type { StoredSource } from "./types.ts";
import { normalizePath } from "./storage/schema.ts";

export const SOURCES_EXCLUDED_REASON =
  "All sources in this Knowledge Space are excluded from search. Include them again to get cited answers.";

// Exact path or a glob such as docs/*.md or **/API_DOCUMENTATION.md.
export function pathExcluded(path: string, patterns?: string[]): boolean {
  if (!patterns || patterns.length === 0) return false;
  const normalized = normalizePath(path);
  return patterns.some((pattern) => matchExclude(normalized, normalizePath(pattern.trim())));
}

export function normalizeExcludePatterns(patterns: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of patterns) {
    const pattern = normalizePath(raw.trim());
    if (!pattern || seen.has(pattern)) continue;
    seen.add(pattern);
    out.push(pattern);
  }
  return out;
}

/** Drop matching chunks and their vectors so retrieve cannot see them. */
export async function dropExcludedEvidence(
  chunks: IndexedChunk[],
  patterns: string[] | undefined,
  vectorStore: VectorStore | null,
): Promise<{ chunks: IndexedChunk[]; droppedIds: string[] }> {
  if (!patterns?.length) return { chunks, droppedIds: [] };
  const kept: IndexedChunk[] = [];
  const droppedIds: string[] = [];
  for (const chunk of chunks) {
    if (pathExcluded(chunk.path, patterns)) droppedIds.push(chunk.id);
    else kept.push(chunk);
  }
  if (droppedIds.length > 0 && vectorStore) await vectorStore.delete(droppedIds);
  return { chunks: kept, droppedIds };
}

export function sourcePathsForExclusion(sources: StoredSource[], packFiles: { path: string }[]): string[] {
  const paths = new Set<string>();
  for (const file of packFiles) paths.add(file.path);
  for (const source of sources) paths.add(source.path);
  return [...paths];
}

export function countExcludedSources(
  sources: StoredSource[],
  packFiles: { path: string }[],
  patterns?: string[],
): { total: number; excluded: number } {
  const paths = sourcePathsForExclusion(sources, packFiles);
  if (paths.length === 0) return { total: 0, excluded: 0 };
  if (!patterns?.length) return { total: paths.length, excluded: 0 };
  const excluded = paths.filter((path) => pathExcluded(path, patterns)).length;
  return { total: paths.length, excluded };
}

export function allSourcesExcluded(
  sources: StoredSource[],
  packFiles: { path: string }[],
  patterns?: string[],
): boolean {
  const { total, excluded } = countExcludedSources(sources, packFiles, patterns);
  return total > 0 && excluded === total;
}

export function toggleExcludePath(patterns: string[] | undefined, path: string): string[] {
  const normalized = normalizePath(path);
  const current = normalizeExcludePatterns(patterns ?? []);
  return current.includes(normalized)
    ? current.filter((item) => item !== normalized)
    : [...current, normalized];
}

function matchExclude(path: string, pattern: string): boolean {
  if (!pattern) return false;
  if (path === pattern) return true;
  if (!pattern.includes("*") && !pattern.includes("?")) {
    return path.endsWith("/" + pattern);
  }
  return globToRegExp(pattern).test(path);
}

function globToRegExp(pattern: string): RegExp {
  let escaped = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i] ?? "";
    const next = pattern[i + 1] ?? "";
    if (ch === "*" && next === "*") {
      escaped += ".*";
      i += 1;
      continue;
    }
    if (ch === "*") {
      escaped += "[^/]*";
      continue;
    }
    if (ch === "?") {
      escaped += "[^/]";
      continue;
    }
    if (".+^$()[]{}|\\".includes(ch)) escaped += "\\" + ch;
    else escaped += ch;
  }
  return new RegExp("^" + escaped + "$");
}
