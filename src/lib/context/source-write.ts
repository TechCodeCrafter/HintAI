import { byteLengthOf, hashBlob, hashContent } from "./hash.ts";
import type {
  PdfReadiness,
  PdfStoredSource,
  StoredSource,
  TextSourceDraft,
  TextStoredSource,
} from "./types.ts";
import { isPdfDraft, isPdfSource, isTerminalPdfReadiness, isTextSource, type UpsertDraft } from "./types.ts";
import { normalizePath } from "./storage/schema.ts";

export function referencedBlobHashes(sources: StoredSource[]): Set<string> {
  const keys = new Set<string>();
  for (const source of sources) {
    if (!isPdfSource(source)) continue;
    keys.add(`${source.id}:${source.contentHash}`);
    if (source.stagedContentHash) keys.add(`${source.id}:${source.stagedContentHash}`);
  }
  return keys;
}

export function pdfWorkPending(sources: StoredSource[]): boolean {
  return sources.some((source) => {
    if (!isPdfSource(source)) return false;
    if (source.readiness === "pending") return true;
    if (source.readiness === "ready" && !source.chunked) return true;
    if (source.stagedContentHash) {
      if (!source.stagedReadiness || source.stagedReadiness === "pending") return true;
      if (source.stagedReadiness === "ready" && !source.stagedChunked) return true;
      // Terminal-but-not-ready staged is abandoned at activation. Until then
      // the Context still has work to finish so we do not stay half-updated.
      return true;
    }
    return false;
  });
}

export function contextStatusFor(sources: StoredSource[]): "indexing" | "ready" {
  return pdfWorkPending(sources) ? "indexing" : "ready";
}

export async function textSourceFromDraft(
  contextId: string,
  draft: TextSourceDraft,
  prior: StoredSource | undefined,
  now: number,
): Promise<TextStoredSource> {
  const path = normalizePath(draft.path);
  const existing = prior && isTextSource(prior) ? prior : undefined;
  return {
    id: existing?.id ?? (prior && isPdfSource(prior) ? prior.id : crypto.randomUUID()),
    contextId,
    path,
    language: draft.language,
    kind: "file",
    byteLength: byteLengthOf(draft.content),
    contentHash: await hashContent(draft.content),
    content: draft.content,
    createdAt: existing?.createdAt ?? prior?.createdAt ?? now,
    updatedAt: now,
  };
}

export type StagedBlob = {
  sourceId: string;
  contextId: string;
  contentHash: string;
  blob: Blob;
};

export type UpsertResult = {
  sources: StoredSource[];
  blobsToWrite: StagedBlob[];
  hashesToKeep: Set<string>;
  unchanged: boolean;
};

/**
 * Merge drafts into the existing source set. Text rows update in place.
 * PDF same-hash is a no-op. PDF new-hash stages a revision and leaves the
 * active contentHash alone.
 */
export async function mergeUpsert(
  contextId: string,
  drafts: UpsertDraft[],
  existing: StoredSource[],
  now: number,
): Promise<UpsertResult> {
  const byPath = new Map(existing.map((row) => [row.path, row]));
  const next = new Map(existing.map((row) => [row.id, row]));
  const blobsToWrite: StagedBlob[] = [];
  let changed = false;
  const seen = new Set<string>();

  for (const draft of drafts) {
    const path = normalizePath(draft.path);
    if (!path || seen.has(path)) continue;
    seen.add(path);
    const prior = byPath.get(path);

    if (isPdfDraft(draft)) {
      const contentHash = await hashBlob(draft.blob);
      const mimeType = draft.mimeType ?? "application/pdf";
      if (prior && isPdfSource(prior)) {
        if (prior.contentHash === contentHash || prior.stagedContentHash === contentHash) {
          continue;
        }
        const staged: PdfStoredSource = {
          ...prior,
          stagedContentHash: contentHash,
          updatedAt: now,
        };
        next.set(prior.id, staged);
        blobsToWrite.push({ sourceId: prior.id, contextId, contentHash, blob: draft.blob });
        changed = true;
        continue;
      }
      const id = prior?.id ?? crypto.randomUUID();
      const created: PdfStoredSource = {
        id,
        contextId,
        path,
        kind: "pdf",
        mimeType,
        byteLength: draft.blob.size,
        contentHash,
        readiness: "pending",
        createdAt: prior?.createdAt ?? now,
        updatedAt: now,
      };
      if (prior && isTextSource(prior)) next.delete(prior.id);
      next.set(id, created);
      blobsToWrite.push({ sourceId: id, contextId, contentHash, blob: draft.blob });
      changed = true;
      continue;
    }

    const row = await textSourceFromDraft(contextId, draft, prior, now);
    if (prior && isTextSource(prior) && prior.contentHash === row.contentHash && prior.content === draft.content) {
      continue;
    }
    if (prior && isPdfSource(prior) && prior.id === row.id) {
      next.delete(prior.id);
    }
    next.set(row.id, row);
    changed = true;
  }

  const sources = [...next.values()].sort((a, b) => a.path.localeCompare(b.path));
  return {
    sources,
    blobsToWrite,
    hashesToKeep: referencedBlobHashes(sources),
    unchanged: !changed,
  };
}

export type PdfParsePatch = {
  readiness?: PdfReadiness;
  readinessNote?: string;
  pageCount?: number;
  byteLength?: number;
  extractedChars?: number;
  chunked?: boolean;
};

/**
 * Apply a parse result to the matching revision. A staged hash never
 * overwrites the active contentHash here — that swap is activation.
 */
export function applyParseToSources(
  sources: StoredSource[],
  sourceId: string,
  contentHash: string,
  patch: PdfParsePatch,
  now: number,
): StoredSource[] {
  return sources.map((source) => {
    if (!isPdfSource(source) || source.id !== sourceId) return source;
    if (source.stagedContentHash === contentHash) {
      return {
        ...source,
        stagedReadiness: patch.readiness ?? source.stagedReadiness,
        stagedReadinessNote: patch.readinessNote ?? source.stagedReadinessNote,
        stagedPageCount: patch.pageCount ?? source.stagedPageCount,
        stagedByteLength: patch.byteLength ?? source.stagedByteLength,
        stagedExtractedChars: patch.extractedChars ?? source.stagedExtractedChars,
        stagedChunked: patch.chunked ?? source.stagedChunked,
        updatedAt: now,
      };
    }
    if (source.contentHash === contentHash) {
      return {
        ...source,
        readiness: patch.readiness ?? source.readiness,
        readinessNote: patch.readinessNote ?? source.readinessNote,
        pageCount: patch.pageCount ?? source.pageCount,
        byteLength: patch.byteLength ?? source.byteLength,
        extractedChars: patch.extractedChars ?? source.extractedChars,
        chunked: patch.chunked ?? source.chunked,
        updatedAt: now,
      };
    }
    return source;
  });
}

/**
 * Promote a staged revision only when it is ready and chunked.
 * A failed replacement (scanned / unreadable / refused) keeps OLD_HASH
 * active and records the failed update. Brand-new first revisions are
 * not staged — they write the live hash directly.
 */
export function commitStagedPdfs(sources: StoredSource[], now: number): StoredSource[] {
  return sources.map((source) => {
    if (!isPdfSource(source) || !source.stagedContentHash) return source;
    if (!source.stagedReadiness || !isTerminalPdfReadiness(source.stagedReadiness)) {
      return source;
    }
    if (source.stagedReadiness === "ready" && !source.stagedChunked) {
      return source;
    }
    const {
      stagedContentHash,
      stagedReadiness,
      stagedReadinessNote,
      stagedPageCount,
      stagedByteLength,
      stagedExtractedChars,
      stagedChunked,
      lastFailedHash: _priorFailedHash,
      lastFailedReadiness: _priorFailedReadiness,
      lastFailedNote: _priorFailedNote,
      ...rest
    } = source;
    if (stagedReadiness !== "ready") {
      return {
        ...rest,
        lastFailedHash: stagedContentHash,
        lastFailedReadiness: stagedReadiness,
        lastFailedNote: stagedReadinessNote,
        updatedAt: now,
      };
    }
    return {
      ...rest,
      contentHash: stagedContentHash,
      readiness: stagedReadiness,
      readinessNote: stagedReadinessNote,
      pageCount: stagedPageCount ?? source.pageCount,
      byteLength: stagedByteLength ?? source.byteLength,
      extractedChars: stagedExtractedChars ?? source.extractedChars,
      chunked: Boolean(stagedChunked),
      updatedAt: now,
    };
  });
}

/** Hash whose Blob/IR this source still needs parsed. */
export function parseHashOf(source: PdfStoredSource): string {
  return source.stagedContentHash ?? source.contentHash;
}
