import { pathExcluded } from "../context/exclusions.ts";
import type { SpaceMaterialView } from "../context/material-view.ts";
import { fileInMaterial, sourceRefInMaterial } from "../context/material-view.ts";
import type { NormalizedDocument } from "../document/types.ts";
import type { Card, Citation, ConsideredSource, DocumentHit, FileHit, Hit, RepoPack } from "../repo/types.ts";
import { lineAt } from "./evidence.ts";

/** "2 to 3 other files": enough to show what else was read, not a second result list. */
export const CONSIDERED_LIMIT = 3;

/** What is loaded right now. A considered file is only ever built from this. */
export type LoadedMaterial = {
  pack?: RepoPack;
  material?: SpaceMaterialView;
  /** Hydrated PDFs, when the caller has them. */
  document?: (sourceId: string) => NormalizedDocument | undefined;
};

/** Everything the Card already cites, so the list is strictly "other" files. */
function citedKeys(citations: readonly Citation[]): { files: Set<string>; documents: Set<string> } {
  const files = new Set<string>();
  const documents = new Set<string>();
  for (const cite of citations) {
    if (cite.kind === "file") files.add(cite.path);
    if (cite.kind === "document") {
      documents.add(cite.sourceId);
      files.add(cite.path);
    }
  }
  return { files, documents };
}

/**
 * A ranked code chunk as a position in the loaded file, or null when that
 * cannot be shown truthfully: the file is not loaded, it is excluded from
 * search, or the chunk's text is no longer where the index says it is.
 *
 * The line range is recomputed from the loaded content, not copied from the
 * chunk, so a stale index can never print lines that hold something else.
 */
function consideredFile(hit: FileHit, loaded: LoadedMaterial): ConsideredSource | null {
  // A "why" chunk is a commit message. It has no position in any file.
  if (hit.kind !== "code" || !hit.text) return null;
  if (pathExcluded(hit.path, loaded.pack?.excludePatterns)) return null;

  const inMaterial = loaded.material ? fileInMaterial(loaded.material, hit.path, hit.sourceId) : undefined;
  const file = inMaterial ?? loaded.pack?.files.find((item) => item.path === hit.path);
  if (!file) return null;

  const atOffset = file.content.slice(hit.startOffset, hit.startOffset + hit.text.length) === hit.text;
  const start = atOffset ? hit.startOffset : file.content.indexOf(hit.text);
  if (start < 0) return null;
  const end = start + hit.text.length;

  return {
    kind: "file",
    path: hit.path,
    startLine: lineAt(file.content, start),
    endLine: lineAt(file.content, Math.max(start, end - 1)),
    sourceId: inMaterial?.sourceId ?? hit.sourceId,
    displayName: inMaterial?.displayName,
  };
}

/** A ranked PDF chunk as a page of a loaded document, or null when it is not loaded as indexed. */
function consideredDocument(hit: DocumentHit, loaded: LoadedMaterial): ConsideredSource | null {
  if (pathExcluded(hit.path, loaded.pack?.excludePatterns)) return null;
  const ref = loaded.material ? sourceRefInMaterial(loaded.material, hit.sourceId) : undefined;

  if (loaded.document) {
    const document = loaded.document(hit.sourceId);
    if (!document || document.contentHash !== hit.contentHash) return null;
    const page = document.pages.find((entry) => entry.pageNumber === hit.page);
    if (!page || page.text.slice(hit.startOffset, hit.endOffset) !== hit.text) return null;
  } else if (!ref) {
    // No hydrated document and no source record: nothing proves it is loaded.
    return null;
  }

  return {
    kind: "document",
    path: hit.path,
    sourceId: hit.sourceId,
    page: hit.page,
    heading: hit.heading,
    displayName: ref?.displayName,
  };
}

/**
 * The other files retrieval ranked for this question, best first, that the
 * answer does not cite. One entry per file (its best-ranked chunk), capped at
 * `limit`. With nothing loaded to check against, the list is empty.
 */
export function consideredSources(
  hits: readonly Hit[],
  citations: readonly Citation[],
  loaded: LoadedMaterial,
  limit = CONSIDERED_LIMIT,
): ConsideredSource[] {
  if (!loaded.pack && !loaded.material) return [];
  const cited = citedKeys(citations);
  const seen = new Set<string>();
  const out: ConsideredSource[] = [];

  for (const hit of hits) {
    if (out.length >= limit) break;
    if (hit.kind === "document") {
      const key = `document:${hit.sourceId}`;
      if (seen.has(key) || cited.documents.has(hit.sourceId)) continue;
      const entry = consideredDocument(hit, loaded);
      if (!entry) continue;
      seen.add(key);
      out.push(entry);
      continue;
    }
    // Paths are unique inside a space (prefixed per source), so the path is the file.
    const key = `file:${hit.path}`;
    if (seen.has(key) || cited.files.has(hit.path)) continue;
    const entry = consideredFile(hit, loaded);
    if (!entry) continue;
    seen.add(key);
    out.push(entry);
  }
  return out;
}

/**
 * The entries that are still loaded. A Card restored from history was built
 * against the material of its day; a file removed since must not be offered.
 */
export function stillLoaded(
  sources: readonly ConsideredSource[] | undefined,
  loaded: { paths: ReadonlySet<string>; sourceIds: ReadonlySet<string> },
): ConsideredSource[] {
  if (!sources) return [];
  return sources.filter((source) =>
    source.kind === "file" ? loaded.paths.has(source.path) : loaded.sourceIds.has(source.sourceId),
  );
}

/** The Card with its considered list set from the hits it was answered from. */
export function withConsidered<T extends Card>(card: T, hits: readonly Hit[], loaded: LoadedMaterial): T {
  const considered = consideredSources(hits, card.citations ?? [], loaded);
  if (considered.length === 0) {
    if (card.considered === undefined) return card;
    const { considered: _dropped, ...rest } = card;
    return rest as T;
  }
  return { ...card, considered };
}

/** `src/exporter/retry.ts:4-28`, or `handbook.pdf · Page 3`. The same shape a citation chip prints. */
export function consideredText(source: ConsideredSource): string {
  if (source.kind === "document") {
    const heading = source.heading ? ` · "${source.heading}"` : "";
    return `${source.displayName ?? source.path} · Page ${source.page}${heading}`;
  }
  const range = source.endLine > source.startLine ? `${source.startLine}-${source.endLine}` : `${source.startLine}`;
  const coords = `${source.path}:${range}`;
  return source.displayName ? `${source.displayName} · ${coords}` : coords;
}
