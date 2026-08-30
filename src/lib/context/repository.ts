import type { NormalizedDocument } from "../document/types.ts";
import type { IndexedChunk } from "../repo/types.ts";
import type { IndexedSourceRecord } from "./index-types.ts";
import type { PdfParsePatch } from "./source-write.ts";
import type { ContextRecord, SourceDraft, StoredSource, UpsertDraft } from "./types.ts";

/**
 * Persistence seam. Search, the store, and the cockpit talk to this — never
 * to Dexie or IndexedDB. A later SQLite backend implements the same methods.
 */
export type ContextRepository = {
  listContexts(): Promise<ContextRecord[]>;
  getContext(id: string): Promise<ContextRecord | null>;
  createContext(input: { name: string; description?: string }): Promise<ContextRecord>;
  replaceSources(contextId: string, drafts: SourceDraft[]): Promise<StoredSource[]>;
  upsertSources(contextId: string, drafts: UpsertDraft[]): Promise<StoredSource[]>;
  listSources(contextId: string): Promise<StoredSource[]>;
  countSources(contextId: string): Promise<number>;
  deleteContext(id: string): Promise<void>;
  listIndexed(contextId: string): Promise<IndexedSourceRecord[]>;
  readIndexedChunks(contextId: string, sourceId: string, contentHash?: string): Promise<IndexedChunk[] | null>;
  writeIndexed(record: IndexedSourceRecord, chunks: IndexedChunk[]): Promise<void>;
  deleteIndexed(contextId: string, sourceIds?: string[]): Promise<void>;
  getSourceBlob(sourceId: string, contentHash: string): Promise<Blob | null>;
  getNormalizedDocument(sourceId: string, contentHash?: string): Promise<NormalizedDocument | null>;
  putNormalizedDocument(contextId: string, document: NormalizedDocument): Promise<void>;
  applyPdfParseResult(
    contextId: string,
    sourceId: string,
    contentHash: string,
    result: PdfParsePatch & { document?: NormalizedDocument },
  ): Promise<StoredSource | null>;
  beginContextActivation(contextId: string): Promise<ContextRecord>;
  completeContextActivation(contextId: string): Promise<ContextRecord>;
};

export class ContextNotFoundError extends Error {
  constructor(id: string) {
    super(`Context ${id} was not found`);
    this.name = "ContextNotFoundError";
  }
}
