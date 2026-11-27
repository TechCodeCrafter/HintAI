import { buildDocumentChunks, isUsableDocumentChunk } from "../document/chunk.ts";
import { deriveDocumentStructure } from "../document/structure.ts";
import { PDF_LIMITS } from "../document/pdf/limits.ts";
import { READINESS_NOTES } from "../document/pdf/notes.ts";
import { pathExcluded } from "./exclusions.ts";
import { preferredOpenFile, prunePack, storedPathForRules } from "../repo/folder.ts";
import type { Chunk, IndexedChunk, RepoFile, RepoPack } from "../repo/types.ts";
import { isDocumentChunk } from "../repo/types.ts";
import { defaultWorkspaceId } from "../auth/workspace.ts";
import { tagChunksForScope } from "../search/retrieval-scope.ts";
import { buildChunks, isEvidencePath, packVocabulary } from "../search/retrieve.ts";
import type { HydratedRuntime } from "./hydrate.ts";
import { summarizeIndex, type IndexSummary } from "./index-summary.ts";
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
import { ContextNotFoundError, type ContextRepository, type IndexedWrite } from "./repository.ts";
import { isPdfSource, isTextSource, type PdfStoredSource, type StoredSource, type TextStoredSource } from "./types.ts";

/**
 * How long an index pass waits for embeddings. Long enough that a small
 * folder is fully embedded when it reports ready; short enough that a large
 * one is not kept waiting on the model.
 */
export const EMBED_WAIT_MS = 1500;

export type IndexOptions = {
  chunkerVersion?: number;
  indexVersion?: number;
  documentChunkerVersion?: number;
  parserVersion?: number;
  normalizerVersion?: number;
  structureVersion?: number;
  /**
   * Keep every persisted source, including ones in vendor and build folders,
   * in stored order. The bench uses this so a 1,000-file Context is actually
   * 1,000 files.
   */
  skipPrune?: boolean;
  /** When this returns true, persist may still finish; the caller must not apply. */
  isCancelled?: () => boolean;
  /** Overrides USE_STRUCTURED_CHUNKER for this index pass. Does not bump CHUNKER_VERSION. */
  structured?: boolean;
  /** Generate embeddings after chunks are built. Defaults to USE_HYBRID_RETRIEVAL. */
  embed?: boolean;
  /**
   * How long the pass waits for embeddings before it returns. Encoding that
   * is not finished by then carries on in the background, in small batches.
   * Search does not need the vectors to work. Defaults to `EMBED_WAIT_MS`.
   */
  embedWaitMs?: number;
  vectorStore?: VectorStore;
  /** Called before the first file and after each one, with the counts so far. */
  onProgress?: (progress: IndexProgress) => void;
};

/**
 * How far an index pass has got. Counted by the loop that builds the chunks,
 * so a status line read from it cannot run ahead of the work.
 */
export type IndexProgress = {
  /** Files handled so far: chunked, read from cache, or failed. */
  filesDone: number;
  /** Files this pass will handle. Null when it is not known yet (a space with several contexts). */
  filesTotal: number | null;
  /** Chunks assembled so far. */
  chunks: number;
};

export type IndexedRuntime = HydratedRuntime & {
  /**
   * The stored sources this pass read, when they are still what storage
   * holds. Unset when the pass changed a source row (a PDF it marked as
   * chunked), so the caller reads them again.
   */
  sources?: StoredSource[];
  report: IndexReport;
  /** Files and chunks actually searchable, and every stored file that is not. */
  summary: IndexSummary;
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
    ("sourceId" in a ? a.sourceId : undefined) === ("sourceId" in b ? b.sourceId : undefined) &&
    a.path === b.path &&
    a.startLine === b.startLine &&
    a.endLine === b.endLine &&
    a.startOffset === b.startOffset &&
    a.heading === b.heading &&
    a.text === b.text &&
    a.sha === b.sha &&
    a.author === b.author &&
    a.date === b.date &&
    a.pr === b.pr &&
    a.message === b.message
  );
}

export function chunksFromFile(
  file: RepoFile,
  source: TextStoredSource,
  options?: { structured?: boolean },
): Chunk[] {
  const chunkScope = {
    workspaceId: source.workspaceId ?? defaultWorkspaceId(),
    contextId: source.contextId,
    sourceId: source.sourceId,
  };
  return buildChunks(
    {
      id: "file",
      name: "file",
      description: "",
      files: [file],
      commits: [],
    },
    {
      ...options,
      chunkScope,
      sourceId: source.sourceId,
      pathForRules: (path) => storedPathForRules(path, source.pathPrefix),
    },
  );
}

/**
 * A cached "no chunks" row for a file that should have chunks is not reused.
 * Rows like that were written while the folder's own name was judged (a
 * folder called `build`), and would otherwise keep the file unsearchable
 * until its content changed.
 */
function staleEmptyLedger(ledger: IndexedSourceRecord, source: TextStoredSource): boolean {
  return (
    ledger.chunkCount === 0 &&
    source.content.trim().length > 0 &&
    isEvidencePath(storedPathForRules(source.path, source.pathPrefix))
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

/** Freshly built chunks and the ledger row that says they are current. */
function rebuiltWrite(
  source: TextStoredSource,
  chunks: Chunk[],
  chunkerVersion: number,
  indexVersion: number,
): IndexedWrite {
  const record: IndexedSourceRecord = {
    id: indexedSourceKey(source.contextId, source.id),
    workspaceId: source.workspaceId ?? defaultWorkspaceId(),
    contextId: source.contextId,
    sourceId: source.id,
    contentHash: source.contentHash,
    chunkerVersion,
    indexVersion,
    indexedAt: Date.now(),
    chunkCount: chunks.length,
  };
  return { record, chunks };
}

/**
 * Files handled between two writes to storage.
 *
 * A file at a time is one transaction per file, and on a few thousand files
 * the transactions were most of the indexing time. A batch is one write. It
 * is also the unit of progress and of cancellation: the count on screen moves
 * once per batch, and a pass that is cancelled or interrupted keeps every
 * batch it finished, so the next pass rebuilds only what is left.
 */
export const INDEX_BATCH_FILES = 40;

async function readCachedChunks(
  repo: ContextRepository,
  contextId: string,
  sourceIds: string[],
): Promise<Map<string, IndexedChunk[] | null>> {
  if (sourceIds.length === 0) return new Map();
  if (repo.readIndexedChunksMany) return repo.readIndexedChunksMany(contextId, sourceIds);
  const out = new Map<string, IndexedChunk[] | null>();
  for (const sourceId of sourceIds) out.set(sourceId, await repo.readIndexedChunks(contextId, sourceId));
  return out;
}

async function writeRebuilt(repo: ContextRepository, writes: IndexedWrite[]): Promise<void> {
  if (writes.length === 0) return;
  if (repo.writeIndexedBatch) return repo.writeIndexedBatch(writes);
  for (const { record, chunks } of writes) await repo.writeIndexed(record, chunks);
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
    workspaceId: source.workspaceId ?? defaultWorkspaceId(),
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
  const byPath = new Map(sources.map((source) => [source.path, source]));
  const { pack: pruned, weak } = prunePack(pack, (path) => byPath.get(path)?.pathPrefix ?? "");
  const use = options.skipPrune ? pack : pruned.files.length > 0 ? pruned : pack;
  timings.hydrateMs = nowMs() - hydrateStart;

  const exclude = use.excludePatterns;
  const excludedIds = sources.filter((source) => pathExcluded(source.path, exclude)).map((source) => source.id);
  if (excludedIds.length > 0) {
    await repo.deleteIndexed(contextId, excludedIds);
    stats.deletedSourceCount += excludedIds.length;
  }

  const active = use.files
    .map((file) => {
      const source = byPath.get(file.path);
      return source && isTextSource(source) ? { file, source } : null;
    })
    .filter((row): row is { file: RepoFile; source: TextStoredSource } => row !== null)
    .filter(({ file }) => !pathExcluded(file.path, exclude));
  const pdfs = sources.filter(
    (source): source is PdfStoredSource =>
      isPdfSource(source) && !pathExcluded(source.path, exclude),
  );

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
  const filesTotal = active.length + pdfs.length;
  let filesDone = 0;
  const tick = () => options.onProgress?.({ filesDone, filesTotal, chunks: assembled.length });
  tick();
  for (let from = 0; from < active.length; from += INDEX_BATCH_FILES) {
    if (options.isCancelled?.()) break;
    const batch = active.slice(from, from + INDEX_BATCH_FILES);
    // Files whose ledger says the stored chunks are current: read them together.
    const current = batch.filter(({ source }) => {
      const ledger = ledgerBySource.get(source.id);
      return Boolean(ledger && ledgerValid(ledger, source, chunkerVersion, indexVersion) && !staleEmptyLedger(ledger, source));
    });
    const readStart = nowMs();
    const cachedBySource = await readCachedChunks(
      repo,
      contextId,
      current.map(({ source }) => source.id),
    );
    timings.cacheReadMs += nowMs() - readStart;

    const buildStart = nowMs();
    const writes: IndexedWrite[] = [];
    const batchChunks: IndexedChunk[] = [];
    let handled = 0;
    for (const { file, source } of batch) {
      // Asked per file, so a cancelled pass stops chunking at once. What this
      // batch has built so far is still written below.
      if (options.isCancelled?.()) break;
      handled += 1;
      const ledger = ledgerBySource.get(source.id);
      const cached = cachedBySource.get(source.id);
      if (ledger && cached !== undefined && cacheChunksValid(cached, ledger.chunkCount)) {
        batchChunks.push(...orderFileChunks(cached));
        stats.reusedSourceCount += 1;
        stats.reusedChunkCount += cached.length;
        continue;
      }
      let chunks: Chunk[];
      try {
        chunks = chunksFromFile(file, source, { structured: options.structured });
      } catch (error) {
        // One file the chunker cannot handle must not take the other files down
        // with it. It gets no ledger row, so the next pass tries it again, and
        // the summary names it as a file with no chunks.
        console.warn(`Could not index ${file.path}`, error);
        continue;
      }
      writes.push(rebuiltWrite(source, chunks, chunkerVersion, indexVersion));
      batchChunks.push(...chunks);
      stats.rebuiltSourceCount += 1;
      stats.rebuiltChunkCount += chunks.length;
      if (!ledger) stats.newSourceCount += 1;
    }
    // A failed write is not caught: storage that cannot be written fails the pass.
    await writeRebuilt(repo, writes);
    timings.chunkBuildMs += nowMs() - buildStart;
    assembled.push(...batchChunks);
    // Counted after the write, so the number on screen is work that is kept.
    filesDone += handled;
    tick();
  }

  for (const source of pdfs) {
    if (options.isCancelled?.()) break;
    if (source.stagedContentHash) {
      await indexPdfSource(repo, source, source.stagedContentHash, versions, stats, timings);
    }
    const live = await indexPdfSource(repo, source, source.contentHash, versions, stats, timings);
    assembled.push(...live);
    filesDone += 1;
    tick();
  }

  const commits = commitChunks(use);
  assembled.push(...commits);
  timings.assembleMs = nowMs() - assembleStart;

  const scope = {
    workspaceId: context.workspaceId ?? defaultWorkspaceId(),
    spaceId: context.id,
    contextId: context.id,
    contextIds: [context.id],
  };
  const scopedChunks = tagChunksForScope(assembled, scope);

  const shouldEmbed = options.embed ?? USE_HYBRID_RETRIEVAL;
  if (shouldEmbed) {
    const embedStart = nowMs();
    try {
      const store = options.vectorStore ?? (await defaultVectorStore());
      if (store) {
        setVectorStore(store);
        const { embedInBackground } = await import("../search/embed-chunks.ts");
        // A large folder is not held at "indexing" until every chunk has a
        // vector. The pass waits a moment, which is all a small folder needs,
        // and the encoding carries on after it has returned.
        const embedding = embedInBackground(scopedChunks, store, { isCancelled: options.isCancelled });
        await settledWithin(embedding, options.embedWaitMs ?? EMBED_WAIT_MS);
      }
    } catch {
      // Embedding is a sidecar. A failed encode must not block searchability.
    }
    timings.embedMs = nowMs() - embedStart;
  }

  const vocabStart = nowMs();
  const vocab = packVocabulary(scopedChunks);
  timings.vocabMs = nowMs() - vocabStart;
  timings.totalMs = nowMs() - started;

  const cancelled = Boolean(options.isCancelled?.());
  const report: IndexReport = { ...stats, ...timings };
  lastReport = report;

  return {
    pack: use,
    chunks: scopedChunks,
    vocab,
    openFile: preferredOpenFile(use) ?? use.files[0]?.path ?? null,
    weak,
    report,
    summary: summarizeIndex(sources, scopedChunks, exclude),
    cancelled,
    ...(pdfs.length === 0 ? { sources } : {}),
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

/**
 * One store per account database for the life of the tab. It keeps the
 * vectors it has read in memory, so making a new one for every index pass
 * would throw that away and read them all again.
 */
let accountVectorStore: { name: string; store: VectorStore } | null = null;

async function defaultVectorStore(): Promise<VectorStore | null> {
  try {
    const { currentAccountId, vectorDatabaseName } = await import("../auth/account-boundary.ts");
    const accountId = currentAccountId();
    if (!accountId) return null;
    const name = vectorDatabaseName(accountId);
    if (accountVectorStore?.name === name) return accountVectorStore.store;
    const { createIndexedDbVectorStore } = await import("./storage/vector-store-indexeddb.ts");
    accountVectorStore = { name, store: createIndexedDbVectorStore(name) };
    return accountVectorStore.store;
  } catch {
    return null;
  }
}

/** Waits for `work`, but no longer than `ms`. The timer is cleared either way. */
async function settledWithin(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, Math.max(0, ms));
  });
  try {
    await Promise.race([work.then(() => undefined), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

export { CHUNKER_VERSION, RETRIEVAL_INDEX_VERSION, STORED_CHUNK_SCHEMA };
