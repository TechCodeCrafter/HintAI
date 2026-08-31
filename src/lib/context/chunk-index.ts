import { buildDocumentChunks, isUsableDocumentChunk } from "../document/chunk.ts";
import { deriveDocumentStructure } from "../document/structure.ts";
import { PDF_LIMITS } from "../document/pdf/limits.ts";
import { READINESS_NOTES } from "../document/pdf/notes.ts";
import { preferredOpenFile, prunePack } from "../repo/folder.ts";
import type { Chunk, IndexedChunk, RepoFile, RepoPack } from "../repo/types.ts";
import { isDocumentChunk } from "../repo/types.ts";
import { buildChunks, packVocabulary } from "../search/retrieve.ts";
import type { HydratedRuntime } from "./hydrate.ts";
import { packFromSources } from "./hydrate.ts";
import {
  documentLedgerKey,
  emptyIndexStats,
  indexedSourceKey,
  type IndexReport,
  type IndexedSourceRecord,
} from "./index-types.ts";
import type { VectorStore } from "../search/vector-store.ts";
import { setVectorStore } from "../search/vector-access.ts";
import {
  CHUNKER_VERSION,
  DOCUMENT_CHUNKER_VERSION,
  DOCUMENT_NORMALIZER_VERSION,
  DOCUMENT_STRUCTURE_VERSION,
  PDF_PARSER_VERSION,
  RETRIEVAL_INDEX_VERSION,
  STORED_CHUNK_SCHEMA,
  USE_HYBRID_RETRIEVAL,
} from "./index-versions.ts";
import { ContextNotFoundError, type ContextRepository } from "./repository.ts";
import { isPdfSource, isTextSource, type PdfStoredSource, type StoredSource, type TextStoredSource } from "./types.ts";

export type IndexOptions = {
  chunkerVersion?: number;
  indexVersion?: number;
  documentChunkerVersion?: number;
  parserVersion?: number;
  normalizerVersion?: number;
  structureVersion?: number;
  /**
   * Keep every persisted source. Folder import still prunes; the bench uses
   * this so a 1,000-file Context is actually 1,000 files.
   */
  skipPrune?: boolean;
  /** When this returns true, persist may still finish; the caller must not apply. */
  isCancelled?: () => boolean;
  /** Overrides USE_STRUCTURED_CHUNKER for this index pass. Does not bump CHUNKER_VERSION. */
  structured?: boolean;
  /** Generate embeddings after chunks are built. Defaults to USE_HYBRID_RETRIEVAL. */
  embed?: boolean;
  vectorStore?: VectorStore;
};

export type IndexedRuntime = HydratedRuntime & {
  report: IndexReport;
  cancelled: boolean;
};

let lastReport: IndexReport | null = null;

export function lastIndexReport(): IndexReport | null {
  return lastReport;
}

export function chunksEquivalent(a: IndexedChunk[], b: IndexedChunk[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort((x, y) => x.id.localeCompare(y.id));
  const right = [...b].sort((x, y) => x.id.localeCompare(y.id));
  for (let i = 0; i < left.length; i += 1) {
    if (!chunkEquivalent(left[i], right[i])) return false;
  }
  return true;
}

export function chunkEquivalent(a: IndexedChunk, b: IndexedChunk): boolean {
  if (a.kind === "document" || b.kind === "document") {
    if (a.kind !== "document" || b.kind !== "document") return false;
    return (
      a.id === b.id &&
      a.sourceId === b.sourceId &&
      a.path === b.path &&
      a.page === b.page &&
      a.startOffset === b.startOffset &&
      a.endOffset === b.endOffset &&
      a.text === b.text &&
      a.contentHash === b.contentHash
    );
  }
  return (
    a.id === b.id &&
    a.kind === b.kind &&
    a.path === b.path &&
    a.startLine === b.startLine &&
    a.endLine === b.endLine &&
    a.startOffset === b.startOffset &&
    a.text === b.text &&
    a.sha === b.sha &&
    a.author === b.author &&
    a.date === b.date &&
    a.pr === b.pr &&
    a.message === b.message
  );
}

export function chunksFromFile(file: RepoFile, options?: { structured?: boolean }): Chunk[] {
  return buildChunks(
    {
      id: "file",
      name: "file",
      description: "",
      files: [file],
      commits: [],
    },
    options,
  );
}

export function commitChunks(pack: RepoPack): Chunk[] {
  if (pack.commits.length === 0) return [];
  return buildChunks({ ...pack, files: [] });
}

function isUsableChunk(chunk: unknown): chunk is Chunk {
  if (!chunk || typeof chunk !== "object") return false;
  const row = chunk as Chunk;
  return (
    typeof row.id === "string" &&
    (row.kind === "code" || row.kind === "why") &&
    typeof row.path === "string" &&
    typeof row.startLine === "number" &&
    typeof row.endLine === "number" &&
    typeof row.startOffset === "number" &&
    typeof row.text === "string"
  );
}

function ledgerValid(
  ledger: IndexedSourceRecord,
  source: StoredSource,
  chunkerVersion: number,
  indexVersion: number,
): boolean {
  return (
    ledger.sourceId === source.id &&
    ledger.contextId === source.contextId &&
    ledger.contentHash === source.contentHash &&
    ledger.chunkerVersion === chunkerVersion &&
    ledger.indexVersion === indexVersion &&
    Number.isFinite(ledger.chunkCount) &&
    ledger.chunkCount >= 0
  );
}

function documentLedgerValid(
  ledger: IndexedSourceRecord,
  source: PdfStoredSource,
  contentHash: string,
  versions: { parser: number; normalizer: number; structure: number; documentChunker: number; index: number },
): boolean {
  return (
    ledger.sourceId === source.id &&
    ledger.contextId === source.contextId &&
    ledger.contentHash === contentHash &&
    ledger.parserVersion === versions.parser &&
    ledger.normalizerVersion === versions.normalizer &&
    ledger.structureVersion === versions.structure &&
    ledger.documentChunkerVersion === versions.documentChunker &&
    ledger.indexVersion === versions.index &&
    Number.isFinite(ledger.chunkCount) &&
    ledger.chunkCount >= 0
  );
}

function cacheChunksValid(chunks: IndexedChunk[] | null, expected: number): chunks is Chunk[] {
  if (!chunks) return false;
  if (chunks.length !== expected) return false;
  return chunks.every(isUsableChunk);
}

function cacheDocumentChunksValid(chunks: IndexedChunk[] | null, expected: number): chunks is IndexedChunk[] {
  if (!chunks) return false;
  if (chunks.length !== expected) return false;
  return chunks.every((chunk) => isUsableDocumentChunk(chunk));
}

function orderFileChunks(chunks: Chunk[]): Chunk[] {
  return [...chunks].sort(
    (a, b) => a.startOffset - b.startOffset || a.startLine - b.startLine || a.id.localeCompare(b.id),
  );
}

function orderDocumentChunks(chunks: IndexedChunk[]): IndexedChunk[] {
  return [...chunks].filter(isDocumentChunk).sort(
    (a, b) => a.page - b.page || a.startOffset - b.startOffset || a.id.localeCompare(b.id),
  );
}

async function rebuildSource(
  repo: ContextRepository,
  source: StoredSource,
  file: RepoFile,
  chunkerVersion: number,
  indexVersion: number,
  structured?: boolean,
): Promise<Chunk[]> {
  const chunks = chunksFromFile(file, { structured });
  const record: IndexedSourceRecord = {
    id: indexedSourceKey(source.contextId, source.id),
    contextId: source.contextId,
    sourceId: source.id,
    contentHash: source.contentHash,
    chunkerVersion,
    indexVersion,
    indexedAt: Date.now(),
    chunkCount: chunks.length,
  };
  await repo.writeIndexed(record, chunks);
  return chunks;
}

async function persistDocumentChunks(
  repo: ContextRepository,
  source: PdfStoredSource,
  contentHash: string,
  chunks: IndexedChunk[],
  versions: { parser: number; normalizer: number; structure: number; documentChunker: number; index: number },
): Promise<void> {
  const record: IndexedSourceRecord = {
    id: documentLedgerKey(source.contextId, source.id, contentHash),
    contextId: source.contextId,
    sourceId: source.id,
    contentHash,
    chunkerVersion: CHUNKER_VERSION,
    indexVersion: versions.index,
    indexedAt: Date.now(),
    chunkCount: chunks.length,
    parserVersion: versions.parser,
    normalizerVersion: versions.normalizer,
    structureVersion: versions.structure,
    documentChunkerVersion: versions.documentChunker,
  };
  await repo.writeIndexed(record, chunks);
  await repo.applyPdfParseResult(source.contextId, source.id, contentHash, { chunked: true });
}

/**
 * Incremental index for a persisted Context.
 *
 * Persist of valid cache rows is allowed after cancellation. The caller must
 * still drop the returned runtime when `cancelled` is true so a late A cannot
 * replace B.
 */
export async function indexContext(
  repo: ContextRepository,
  contextId: string,
  options: IndexOptions = {},
): Promise<IndexedRuntime> {
  const chunkerVersion = options.chunkerVersion ?? CHUNKER_VERSION;
  const indexVersion = options.indexVersion ?? RETRIEVAL_INDEX_VERSION;
  const versions = {
    parser: options.parserVersion ?? PDF_PARSER_VERSION,
    normalizer: options.normalizerVersion ?? DOCUMENT_NORMALIZER_VERSION,
    structure: options.structureVersion ?? DOCUMENT_STRUCTURE_VERSION,
    documentChunker: options.documentChunkerVersion ?? DOCUMENT_CHUNKER_VERSION,
    index: indexVersion,
  };
  const started = nowMs();
  const stats = emptyIndexStats();
  const timings = {
    hydrateMs: 0,
    hashCompareMs: 0,
    cacheReadMs: 0,
    chunkBuildMs: 0,
    assembleMs: 0,
    vocabMs: 0,
    embedMs: 0,
    totalMs: 0,
  };

  const hydrateStart = nowMs();
  const context = await repo.getContext(contextId);
  if (!context) throw new ContextNotFoundError(contextId);
  const sources = await repo.listSources(contextId);
  const pack = packFromSources(context, sources);
  const { pack: pruned, weak } = prunePack(pack);
  const use = options.skipPrune ? pack : pruned.files.length > 0 ? pruned : pack;
  timings.hydrateMs = nowMs() - hydrateStart;

  const byPath = new Map(sources.map((source) => [source.path, source]));
  const active = use.files
    .map((file) => {
      const source = byPath.get(file.path);
      return source && isTextSource(source) ? { file, source } : null;
    })
    .filter((row): row is { file: RepoFile; source: TextStoredSource } => row !== null);
  const pdfs = sources.filter(isPdfSource);

  const compareStart = nowMs();
  const ledgers = await repo.listIndexed(contextId);
  const ledgerBySource = new Map(ledgers.filter((row) => !row.parserVersion).map((row) => [row.sourceId, row]));
  const liveIds = new Set(sources.map((source) => source.id));
  const staleIds = [...new Set(ledgers.filter((row) => !liveIds.has(row.sourceId)).map((row) => row.sourceId))];
  timings.hashCompareMs = nowMs() - compareStart;

  if (staleIds.length > 0) {
    await repo.deleteIndexed(contextId, staleIds);
    stats.deletedSourceCount = staleIds.length;
  }

  const assembled: IndexedChunk[] = [];
  const assembleStart = nowMs();
  for (const { file, source } of active) {
    if (options.isCancelled?.()) break;
    const ledger = ledgerBySource.get(source.id);
    const known = Boolean(ledger);
    if (ledger && ledgerValid(ledger, source, chunkerVersion, indexVersion)) {
      const readStart = nowMs();
      const cached = await repo.readIndexedChunks(contextId, source.id);
      timings.cacheReadMs += nowMs() - readStart;
      if (cacheChunksValid(cached, ledger.chunkCount)) {
        assembled.push(...orderFileChunks(cached));
        stats.reusedSourceCount += 1;
        stats.reusedChunkCount += cached.length;
        continue;
      }
    }
    const buildStart = nowMs();
    const built = await rebuildSource(repo, source, file, chunkerVersion, indexVersion, options.structured);
    timings.chunkBuildMs += nowMs() - buildStart;
    assembled.push(...built);
    stats.rebuiltSourceCount += 1;
    stats.rebuiltChunkCount += built.length;
    if (!known) stats.newSourceCount += 1;
  }

  for (const source of pdfs) {
    if (options.isCancelled?.()) break;
    if (source.stagedContentHash) {
      await indexPdfSource(repo, source, source.stagedContentHash, versions, stats, timings);
    }
    const live = await indexPdfSource(repo, source, source.contentHash, versions, stats, timings);
    assembled.push(...live);
  }

  const commits = commitChunks(use);
  assembled.push(...commits);
  timings.assembleMs = nowMs() - assembleStart;

  const shouldEmbed = options.embed ?? USE_HYBRID_RETRIEVAL;
  if (shouldEmbed) {
    const embedStart = nowMs();
    try {
      const store = options.vectorStore ?? (await defaultVectorStore());
      if (store) {
        setVectorStore(store);
        const { embedIndexedChunks } = await import("../search/embed-chunks.ts");
        await embedIndexedChunks(assembled, store);
      }
    } catch {
      // Embedding is a sidecar. A failed encode must not block searchability.
    }
    timings.embedMs = nowMs() - embedStart;
  }

  const vocabStart = nowMs();
  const vocab = packVocabulary(assembled);
  timings.vocabMs = nowMs() - vocabStart;
  timings.totalMs = nowMs() - started;

  const cancelled = Boolean(options.isCancelled?.());
  const report: IndexReport = { ...stats, ...timings };
  lastReport = report;

  return {
    pack: use,
    chunks: assembled,
    vocab,
    openFile: preferredOpenFile(use) ?? use.files[0]?.path ?? null,
    weak,
    report,
    cancelled,
  };
}

async function indexPdfSource(
  repo: ContextRepository,
  source: PdfStoredSource,
  contentHash: string,
  versions: { parser: number; normalizer: number; structure: number; documentChunker: number; index: number },
  stats: ReturnType<typeof emptyIndexStats>,
  timings: { cacheReadMs: number; chunkBuildMs: number },
): Promise<IndexedChunk[]> {
  if (source.readiness === "pending" && !source.stagedContentHash) return [];
  const terminal = source.stagedContentHash === contentHash ? source.stagedReadiness : source.readiness;
  if (terminal === "scanned" || terminal === "unreadable" || terminal === "refused") {
    const ledgers = await repo.listIndexed(source.contextId);
    const ledger = ledgers.find((row) => row.sourceId === source.id && row.contentHash === contentHash);
    if (ledger && documentLedgerValid(ledger, source, contentHash, versions) && ledger.chunkCount === 0) {
      const cached = await repo.readIndexedChunks(source.contextId, source.id, contentHash);
      if (cached && cached.length === 0) {
        stats.reusedSourceCount += 1;
        await repo.applyPdfParseResult(source.contextId, source.id, contentHash, { chunked: true });
        return [];
      }
    }
    await persistDocumentChunks(repo, source, contentHash, [], versions);
    stats.rebuiltSourceCount += 1;
    return [];
  }
  if (terminal !== "ready") return [];

  const ledgers = await repo.listIndexed(source.contextId);
  const ledger = ledgers.find((row) => row.sourceId === source.id && row.contentHash === contentHash);
  const known = Boolean(ledger);
  if (ledger && documentLedgerValid(ledger, source, contentHash, versions)) {
    const readStart = nowMs();
    const cached = await repo.readIndexedChunks(source.contextId, source.id, contentHash);
    timings.cacheReadMs += nowMs() - readStart;
    if (cacheDocumentChunksValid(cached, ledger.chunkCount)) {
      await repo.applyPdfParseResult(source.contextId, source.id, contentHash, { chunked: true });
      stats.reusedSourceCount += 1;
      stats.reusedChunkCount += cached.length;
      return orderDocumentChunks(cached);
    }
  }

  const document = await repo.getNormalizedDocument(source.id, contentHash);
  if (!document || document.contentHash !== contentHash) return [];
  if (document.parserVersion !== versions.parser || document.normalizerVersion !== versions.normalizer) {
    return [];
  }

  const buildStart = nowMs();
  const structure = deriveDocumentStructure(document);
  let chunks = buildDocumentChunks(document, structure);
  if (chunks.length > PDF_LIMITS.maxDocumentChunksPerPdf) {
    await repo.applyPdfParseResult(source.contextId, source.id, contentHash, {
      readiness: "refused",
      readinessNote: READINESS_NOTES.refusedChunks,
      chunked: true,
      document: { ...document, readiness: "refused", readinessNote: READINESS_NOTES.refusedChunks },
    });
    await persistDocumentChunks(repo, source, contentHash, [], versions);
    timings.chunkBuildMs += nowMs() - buildStart;
    stats.rebuiltSourceCount += 1;
    return [];
  }
  const existingDocs = (await repo.listIndexed(source.contextId)).reduce((sum, row) => {
    if (!row.documentChunkerVersion || row.sourceId === source.id) return sum;
    return sum + row.chunkCount;
  }, 0);
  if (existingDocs + chunks.length > PDF_LIMITS.maxDocumentChunksPerContext) {
    await repo.applyPdfParseResult(source.contextId, source.id, contentHash, {
      readiness: "refused",
      readinessNote: READINESS_NOTES.refusedContextChunks,
      chunked: true,
      document: { ...document, readiness: "refused", readinessNote: READINESS_NOTES.refusedContextChunks },
    });
    chunks = [];
  }
  await persistDocumentChunks(repo, source, contentHash, chunks, versions);
  timings.chunkBuildMs += nowMs() - buildStart;
  stats.rebuiltSourceCount += 1;
  stats.rebuiltChunkCount += chunks.length;
  if (!known) stats.newSourceCount += 1;
  return orderDocumentChunks(chunks);
}

async function defaultVectorStore(): Promise<VectorStore | null> {
  try {
    const { createIndexedDbVectorStore } = await import("./storage/vector-store-indexeddb.ts");
    return createIndexedDbVectorStore();
  } catch {
    return null;
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export { CHUNKER_VERSION, RETRIEVAL_INDEX_VERSION, STORED_CHUNK_SCHEMA };
