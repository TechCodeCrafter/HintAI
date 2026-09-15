import type { NormalizedDocument } from "../document/types.ts";
import type { IndexedChunk } from "../repo/types.ts";
import type { IndexedSourceRecord } from "./index-types.ts";
import type { PdfParsePatch } from "./source-write.ts";
import type { SpaceRecord } from "./space-types.ts";
import type { ContextKind, ContextRecord, RepoBundleInput, SourceDraft, StoredSource, UpsertDraft } from "./types.ts";

export type CreateContextInput = {
  name: string;
  description?: string;
  kind?: ContextKind;
};

/**
 * Persistence seam. Search, the store, and the cockpit talk to this — never
 * to Dexie or IndexedDB. A later SQLite backend implements the same methods.
 */
export type ContextRepository = {
  listContexts(): Promise<ContextRecord[]>;
  getContext(id: string): Promise<ContextRecord | null>;
  listSpaces(): Promise<SpaceRecord[]>;
  getSpace(id: string): Promise<SpaceRecord | null>;
  createSpace(input: {
    name: string;
    memberContextIds: string[];
    primaryContextId: string;
    id?: string;
  }): Promise<SpaceRecord>;
  createContext(input: CreateContextInput): Promise<ContextRecord>;
  patchContext(
    id: string,
    patch: Partial<Pick<ContextRecord, "name" | "description" | "excludePatterns">>,
  ): Promise<ContextRecord>;
  replaceSources(contextId: string, drafts: SourceDraft[]): Promise<StoredSource[]>;
  /** Add or update one repo bundle without removing other bundles in the context. */
  upsertRepoBundle(contextId: string, bundle: RepoBundleInput): Promise<StoredSource[]>;
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
