export const CONTEXT_SCHEMA_VERSION = 1;

/** Why this context exists. Optional so older IndexedDB rows stay valid. */
export type ContextKind = "work" | "course" | "client" | "presentation" | "research" | "other";

export type ContextRecord = {
  id: string;
  name: string;
  description?: string;
  kind?: ContextKind;
  createdAt: number;
  updatedAt: number;
  /** Cached count. Truth is `sources WHERE contextId = X`. */
  sourceCount: number;
  status: "indexing" | "ready" | "error";
  schemaVersion: number;
};

export type TextStoredSource = {
  id: string;
  contextId: string;
  path: string;
  language?: string;
  kind: "file";
  byteLength: number;
  contentHash: string;
  content: string;
  createdAt: number;
  updatedAt: number;
};

export type PdfReadiness = "pending" | "ready" | "scanned" | "unreadable" | "refused";
export type PdfTerminalReadiness = Exclude<PdfReadiness, "pending">;

export function isTerminalPdfReadiness(readiness: PdfReadiness): readiness is PdfTerminalReadiness {
  return readiness !== "pending";
}

export type PdfStoredSource = {
  id: string;
  contextId: string;
  path: string;
  kind: "pdf";
  mimeType: "application/pdf";
  byteLength: number;
  /** Active snapshot. Citations resolve this hash. */
  contentHash: string;
  /** Candidate revision stored in sourceBlobs; not active until activation completes. */
  stagedContentHash?: string;
  /** Terminal class of the staged revision. Absent while that parse is still pending. */
  stagedReadiness?: PdfReadiness;
  stagedReadinessNote?: string;
  stagedPageCount?: number;
  stagedByteLength?: number;
  stagedExtractedChars?: number;
  pageCount?: number;
  extractedChars?: number;
  /** True when document chunks for the active revision are persisted (or 0-chunk terminal). */
  chunked?: boolean;
  /** True when the staged revision's document chunks are persisted. */
  stagedChunked?: boolean;
  readiness: PdfReadiness;
  readinessNote?: string;
  /** Last abandoned replacement. Active revision stays the previous ready hash. */
  lastFailedHash?: string;
  lastFailedReadiness?: PdfReadiness;
  lastFailedNote?: string;
  createdAt: number;
  updatedAt: number;
};

export type StoredSource = TextStoredSource | PdfStoredSource;

export type ContextRuntimeStatus = "booting" | "hydrating" | "ready" | "error";

export type TextSourceDraft = {
  path: string;
  language?: string;
  content: string;
};

export type PdfSourceDraft = {
  path: string;
  kind: "pdf";
  mimeType?: "application/pdf";
  blob: Blob;
};

/** Folder replace path — text only, unchanged. */
export type SourceDraft = TextSourceDraft;

export type UpsertDraft = TextSourceDraft | PdfSourceDraft;

export function isTextSource(source: StoredSource): source is TextStoredSource {
  return source.kind === "file";
}

export function isPdfSource(source: StoredSource): source is PdfStoredSource {
  return source.kind === "pdf";
}

export function isPdfDraft(draft: UpsertDraft): draft is PdfSourceDraft {
  return "kind" in draft && draft.kind === "pdf";
}

export function isTextDraft(draft: UpsertDraft): draft is TextSourceDraft {
  return !isPdfDraft(draft);
}

/** Strip any accidental blob so listSources never materializes bytes. */
export function metadataOnly(source: StoredSource): StoredSource {
  if (!isPdfSource(source)) return source;
  const { stagedContentHash, ...rest } = source;
  const next: PdfStoredSource = { ...rest };
  if (stagedContentHash) next.stagedContentHash = stagedContentHash;
  return next;
}
