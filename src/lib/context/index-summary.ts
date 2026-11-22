import { isSearchDebug } from "../debug.ts";
import { userFacingPdfNote } from "../document/pdf/source-status.ts";
import { inSkippedFolder, SKIP_LABEL, storedPathForRules, type SkippedFile } from "../repo/folder.ts";
import type { IndexedChunk } from "../repo/types.ts";
import { isEvidencePath } from "../search/retrieve.ts";
import { pathExcluded } from "./exclusions.ts";
import type { RepoPack } from "../repo/types.ts";
import type { PdfStoredSource, StoredSource } from "./types.ts";

/**
 * What the summary needs from a file. A stored source satisfies it; so does a
 * file in a pack that was never stored (the built-in sample).
 */
export type SummarySource =
  | { kind: "file"; path: string; sourceId?: string; pathPrefix?: string; content: string }
  | Pick<PdfStoredSource, "kind" | "path" | "sourceId" | "readiness" | "readinessNote">;

/** Reasons a stored file has no chunks. Load-time reasons are `SKIP_LABEL`. */
export const INDEX_SKIP = {
  excluded: "excluded from search in this space",
  tooling: "generated or tooling files",
  pending: "PDF still being read",
  /** A stored file with text that should have produced chunks and did not. */
  unknown: "no chunks were built",
} as const;

/**
 * What a space holds after indexing, counted from the chunks themselves.
 *
 * `filesIndexed` is the number of files with at least one chunk, so it cannot
 * drift from what search can reach. The pack's file count is not that number:
 * a `.d.ts` file or anything under a dot-directory stays in the pack and
 * produces no chunk.
 */
export type IndexSummary = {
  /** Files stored for the space: text files and PDFs. */
  filesStored: number;
  /** Files with at least one searchable chunk. */
  filesIndexed: number;
  /** Chunks search runs over. */
  chunkCount: number;
  /** Stored files with no chunk, each with the reason. */
  skipped: SkippedFile[];
  /** "structured" when any code chunk is a parsed symbol; otherwise line windows. */
  chunking: "structured" | "windows";
};

export function emptyIndexSummary(): IndexSummary {
  return { filesStored: 0, filesIndexed: 0, chunkCount: 0, skipped: [], chunking: "windows" };
}

function fileKey(sourceId: string | undefined, path: string): string {
  return `${sourceId ?? ""}\u0000${path}`;
}

/**
 * Why a stored file has no chunk, and whether that is a failure.
 *
 * A failure is a file that was meant to be searchable: a PDF with no text
 * layer or one that could not be read, and any file that reached the chunker
 * and came back with nothing. A file left out by a rule (an exclusion, a
 * vendor folder, a page limit) is not a failure.
 */
function reasonFor(
  source: SummarySource,
  excludePatterns: string[] | undefined,
): { reason: string; failed?: true } {
  if (pathExcluded(source.path, excludePatterns)) return { reason: INDEX_SKIP.excluded };
  if (source.kind === "pdf") {
    if (source.readiness === "pending") return { reason: INDEX_SKIP.pending };
    if (source.readiness === "refused") return { reason: userFacingPdfNote(source.readiness, source.readinessNote) };
    if (source.readiness !== "ready") {
      return { reason: userFacingPdfNote(source.readiness, source.readinessNote), failed: true };
    }
    return { reason: INDEX_SKIP.unknown, failed: true };
  }
  if (inSkippedFolder(source.path, source.pathPrefix)) return { reason: SKIP_LABEL.vendor };
  if (!isEvidencePath(storedPathForRules(source.path, source.pathPrefix))) return { reason: INDEX_SKIP.tooling };
  // Content that is not text cannot be chunked. It is a failure, not an empty file.
  if (typeof source.content !== "string") return { reason: INDEX_SKIP.unknown, failed: true };
  if (!source.content.trim()) return { reason: SKIP_LABEL.empty };
  return { reason: INDEX_SKIP.unknown, failed: true };
}

/** True for a file that was meant to be indexed and could not be read or parsed. */
export function isParseFailure(item: SkippedFile): boolean {
  return item.failed === true || item.reason === SKIP_LABEL.failed;
}

/** Files that failed, apart from files left out on purpose. Order is kept. */
export function splitSkipped(skipped: SkippedFile[]): { failed: SkippedFile[]; left: SkippedFile[] } {
  const failed: SkippedFile[] = [];
  const left: SkippedFile[] = [];
  for (const item of skipped) (isParseFailure(item) ? failed : left).push(item);
  return { failed, left };
}

/** Summary for one context: its stored sources against the chunks built from them. */
export function summarizeIndex(
  sources: SummarySource[],
  chunks: IndexedChunk[],
  excludePatterns?: string[],
): IndexSummary {
  const withChunks = new Set<string>();
  let structured = false;
  let chunkCount = 0;
  for (const chunk of chunks) {
    // An excluded file's chunks are never searched, so they are not counted.
    if (pathExcluded(chunk.path, excludePatterns)) continue;
    chunkCount += 1;
    withChunks.add(fileKey(chunk.sourceId, chunk.path));
    if ("symbol" in chunk && chunk.symbol) structured = true;
  }
  const skipped: SkippedFile[] = [];
  let filesIndexed = 0;
  for (const source of sources) {
    if (withChunks.has(fileKey(source.sourceId, source.path))) filesIndexed += 1;
    else skipped.push({ path: source.path, ...reasonFor(source, excludePatterns) });
  }
  skipped.sort((a, b) => a.reason.localeCompare(b.reason) || a.path.localeCompare(b.path));
  return {
    filesStored: sources.length,
    filesIndexed,
    chunkCount,
    skipped,
    chunking: structured ? "structured" : "windows",
  };
}

/**
 * The same summary from what the app holds right now, so it follows every
 * change to the chunks (a re-index, an exclusion toggled) with no state of
 * its own to go stale. With no stored sources it counts the pack's files.
 */
export function summarizeLoaded(
  sources: StoredSource[],
  pack: Pick<RepoPack, "files" | "excludePatterns">,
  chunks: IndexedChunk[],
): IndexSummary {
  const files: SummarySource[] =
    sources.length > 0
      ? sources
      : pack.files.map((file) => ({ kind: "file", path: file.path, content: file.content }));
  return summarizeIndex(files, chunks, pack.excludePatterns);
}

export function mergeIndexSummaries(parts: IndexSummary[]): IndexSummary {
  const merged = emptyIndexSummary();
  for (const part of parts) {
    merged.filesStored += part.filesStored;
    merged.filesIndexed += part.filesIndexed;
    merged.chunkCount += part.chunkCount;
    merged.skipped.push(...part.skipped);
    if (part.chunking === "structured") merged.chunking = "structured";
  }
  return merged;
}

/** How many files a list of skipped entries stands for. A skipped folder counts its files. */
export function skippedFileCount(skipped: SkippedFile[]): number {
  return skipped.reduce((sum, item) => sum + (item.count ?? 1), 0);
}

function plural(count: number, one: string): string {
  return `${count.toLocaleString("en-US")} ${one}${count === 1 ? "" : "s"}`;
}

/** "Indexed 14 files, 22 chunks." */
export function formatIndexSummary(summary: IndexSummary): string {
  return `Indexed ${plural(summary.filesIndexed, "file")}, ${plural(summary.chunkCount, "chunk")}.`;
}

/** Skipped entries grouped by reason, largest group first, for a compact display. */
export function groupSkipped(skipped: SkippedFile[]): { reason: string; files: SkippedFile[]; count: number }[] {
  const groups = new Map<string, SkippedFile[]>();
  for (const item of skipped) {
    const list = groups.get(item.reason);
    if (list) list.push(item);
    else groups.set(item.reason, [item]);
  }
  return [...groups.entries()]
    .map(([reason, files]) => ({ reason, files, count: skippedFileCount(files) }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason));
}

export type IndexDebugRecord = {
  at: number;
  space: string;
  summary: IndexSummary;
  /** Files left out before anything was stored (size, type, cap, unreadable). */
  notLoaded: SkippedFile[];
};

const KEEP = 20;

function debugLog(): IndexDebugRecord[] {
  const host = globalThis as { __meethintIndexDebug?: IndexDebugRecord[] };
  host.__meethintIndexDebug ??= [];
  return host.__meethintIndexDebug;
}

/**
 * Console line for every index pass, behind the same flag as the search log
 * (`VITE_DEBUG_SEARCH` in the browser, `DEBUG_SEARCH` on the server). The
 * last 20 passes stay on `globalThis.__meethintIndexDebug`.
 */
export function reportIndexSummary(space: string, summary: IndexSummary, notLoaded: SkippedFile[] = []): IndexDebugRecord | null {
  if (!isSearchDebug()) return null;
  const record: IndexDebugRecord = { at: Date.now(), space, summary, notLoaded };
  const log = debugLog();
  log.push(record);
  if (log.length > KEEP) log.splice(0, log.length - KEEP);
  const left = skippedFileCount(summary.skipped) + skippedFileCount(notLoaded);
  console.info(
    `[index] ${space}: ${formatIndexSummary(summary)} ${summary.filesStored} stored, ${left} not indexed. Chunking: ${
      summary.chunking === "structured" ? "structured symbols" : "28-line windows"
    }.`,
  );
  for (const group of groupSkipped([...notLoaded, ...summary.skipped])) {
    console.info(`[index]   ${group.count} × ${group.reason}: ${group.files.map((item) => item.path).join(", ")}`);
  }
  return record;
}
