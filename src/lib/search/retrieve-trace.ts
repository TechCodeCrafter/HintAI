import type { Hit, IndexedChunk } from "@/lib/repo/types";
import { isDocumentChunk } from "../repo/types.ts";
import { retrieve } from "./retrieve.ts";

export type RetrievalTraceRow = {
  rank: number;
  kind: IndexedChunk["kind"];
  sourceId?: string;
  path: string;
  page?: number;
  startLine?: number;
  score: number;
};

/** Diagnostic only. Same retrieve() order and scores. */
export function retrieveTrace(query: string, chunks: IndexedChunk[], limit = 6): RetrievalTraceRow[] {
  return retrieve(query, chunks, limit).map((hit, index) => rowOf(hit, index + 1));
}

export function rowOf(hit: Hit, rank: number): RetrievalTraceRow {
  return {
    rank,
    kind: hit.kind,
    sourceId: isDocumentChunk(hit) ? hit.sourceId : undefined,
    path: hit.path,
    page: isDocumentChunk(hit) ? hit.page : undefined,
    startLine: hit.kind === "code" || hit.kind === "why" ? hit.startLine : undefined,
    score: hit.score,
  };
}
