/**
 * Server corpus contract (Phase 2 Milestone A): upload once, never re-parse.
 *
 * The browser parses with the existing local pipeline, then ships the
 * normalized result here in batches (one server call per batch doubles as the
 * progress signal: batch 3/12). Retrieval is Postgres full-text search over
 * chunk text for *recall*; the client re-ranks with its existing scorer and
 * runs the unchanged cite-or-silence card stack for *precision*.
 *
 * Bounds are deliberately generous but finite — per-user quotas graduate to
 * the entitlement service (#50) later; these constants are the v1 backstop.
 */
import type { DocumentChunk, NormalizedPage } from "../document/types.ts";

export const SERVER_CORPUS_LIMITS = {
  /** Max pages accepted for one source in one upload session. */
  maxPagesPerSource: 1200,
  /** Max chunks accepted for one source in one upload session. */
  maxChunksPerSource: 2400,
  /** Pages per upload call — each call is one tick of the progress bar. */
  maxPagesPerBatch: 50,
  /** Serialized batch ceiling: stays under serverless JSON body limits. */
  maxBatchJsonBytes: 3_000_000,
  /** v1 per-user page budget across all spaces (graduates to #50 quotas). */
  maxPagesPerUser: 10_000,
  /** Chunks returned per retrieval call; the client re-ranks from here. */
  maxRetrieveLimit: 12,
} as const;

export type ServerSourceKind = "pdf" | "file";

export type ServerDocMeta = {
  spaceId: string;
  sourceId: string;
  path: string;
  kind: ServerSourceKind;
  contentHash: string;
  parserVersion: number;
  normalizerVersion: number;
};

export type ServerUploadBatch = {
  meta: ServerDocMeta;
  /** Zero-based; batch 0 creates/resets the source row as `uploading`. */
  batchIndex: number;
  /** True on the last batch: flips the source to `ready`. */
  isLast: boolean;
  pages: NormalizedPage[];
  chunks: DocumentChunk[];
};

export type ServerSourceStatus = {
  sourceId: string;
  path: string;
  kind: ServerSourceKind;
  status: "uploading" | "ready" | "stale";
  pageCount: number;
  chunkCount: number;
};

export type ServerCorpusUsage = {
  sources: ServerSourceStatus[];
  totalPages: number;
  pageBudget: number;
};

const ID = /^[A-Za-z0-9._:+-]{1,200}$/;

function bad(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

/** Shape-check one upload batch. The client is not trusted. */
export function validateUploadBatch(
  batch: ServerUploadBatch,
): { ok: true } | { ok: false; reason: string } {
  const meta = batch?.meta;
  if (!meta || typeof meta !== "object") return bad("Missing upload metadata.");
  for (const field of ["spaceId", "sourceId", "path", "contentHash"] as const) {
    const value = meta[field];
    if (typeof value !== "string" || value.length === 0 || value.length > 500) {
      return bad(`Invalid upload field: ${field}.`);
    }
  }
  if (!ID.test(meta.spaceId) || !ID.test(meta.sourceId)) {
    return bad("Invalid space or source id.");
  }
  if (meta.kind !== "pdf" && meta.kind !== "file") return bad("Unknown source kind.");
  if (!Number.isInteger(batch.batchIndex) || batch.batchIndex < 0 || batch.batchIndex > 1000) {
    return bad("Invalid batch index.");
  }
  if (!Array.isArray(batch.pages) || !Array.isArray(batch.chunks)) {
    return bad("Batch must carry pages and chunks arrays.");
  }
  if (batch.pages.length > SERVER_CORPUS_LIMITS.maxPagesPerBatch) {
    return bad(`Batch carries too many pages (max ${SERVER_CORPUS_LIMITS.maxPagesPerBatch}).`);
  }
  for (const page of batch.pages) {
    if (
      !page ||
      !Number.isInteger(page.pageNumber) ||
      typeof page.text !== "string" ||
      page.text.length > 200_000
    ) {
      return bad("Invalid page in batch.");
    }
  }
  for (const chunk of batch.chunks) {
    if (!chunk || typeof chunk.text !== "string" || chunk.text.length > 20_000) {
      return bad("Invalid chunk in batch.");
    }
    if (chunk.sourceId !== meta.sourceId) return bad("Chunk belongs to another source.");
  }
  let size = 0;
  try {
    size = JSON.stringify(batch).length;
  } catch {
    return bad("Batch is not serializable.");
  }
  if (size > SERVER_CORPUS_LIMITS.maxBatchJsonBytes) {
    return bad("Batch is too large; split it and retry.");
  }
  return { ok: true };
}

/**
 * Split pages+chunks into sequential batches client-side. Chunks ride with
 * the batch containing their page so a resumed upload never strands a chunk
 * without its coordinates.
 */
export function buildUploadBatches(
  meta: ServerDocMeta,
  pages: NormalizedPage[],
  chunks: DocumentChunk[],
): ServerUploadBatch[] {
  const per = SERVER_CORPUS_LIMITS.maxPagesPerBatch;
  const byPage = new Map<number, DocumentChunk[]>();
  for (const chunk of chunks) {
    const list = byPage.get(chunk.page) ?? [];
    list.push(chunk);
    byPage.set(chunk.page, list);
  }
  const batches: ServerUploadBatch[] = [];
  for (let i = 0; i < pages.length; i += per) {
    const slice = pages.slice(i, i + per);
    const sliceChunks = slice.flatMap((page) => byPage.get(page.pageNumber) ?? []);
    batches.push({
      meta,
      batchIndex: batches.length,
      isLast: i + per >= pages.length,
      pages: slice,
      chunks: sliceChunks,
    });
  }
  if (batches.length === 0) {
    batches.push({ meta, batchIndex: 0, isLast: true, pages: [], chunks });
  }
  return batches;
}

/** v1 quota arithmetic, pure so the UI and the server agree. */
export function quotaAfterUpload(
  currentPages: number,
  newPages: number,
): { ok: true; totalPages: number } | { ok: false; reason: string } {
  const totalPages = currentPages + newPages;
  if (totalPages > SERVER_CORPUS_LIMITS.maxPagesPerUser) {
    return {
      ok: false,
      reason: `Server corpus is full (${SERVER_CORPUS_LIMITS.maxPagesPerUser.toLocaleString()} pages). Remove a source to free space.`,
    };
  }
  return { ok: true, totalPages };
}
