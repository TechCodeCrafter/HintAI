/**
 * Why a retrieved chunk scored what it did. Diagnostic only — composition
 * never reads these. Mirrors claim-trace: a silent log the eval can dump.
 */

import type { Hit } from "../repo/types.ts";
import { RETRIEVAL_WEIGHTS } from "./retrieval-weights.ts";

export type RetrievalChannel = "semantic" | "lexical" | "structural";
export type RetrievalEvidenceType = "code" | "doc" | "commit";

export type RetrievalTrace = {
  chunkId: string;
  path: string;
  channel: RetrievalChannel;
  evidenceType: RetrievalEvidenceType;
  lexicalScore: number;
  semanticScore: number;
  structuralScore: number;
  combinedScore: number;
  signals: string[];
};

let traces: RetrievalTrace[] = [];
let on = false;

export function traceRetrieval(enabled: boolean): void {
  on = enabled;
  traces = [];
}

export function noteRetrieval(trace: RetrievalTrace): void {
  if (!on) return;
  traces.push(trace);
}

export function retrievalTraces(): RetrievalTrace[] {
  return traces.slice();
}

export function closeRetrieval(tracesForQuery: RetrievalTrace[]): void {
  if (!on) return;
  traces = tracesForQuery.slice();
}

export function evidenceTypeOf(hit: { kind: string; path: string }): RetrievalEvidenceType {
  if (hit.kind === "why") return "commit";
  if (hit.kind === "document") return "doc";
  if (/\.(md|mdx|txt|docx|xlsx|csv|rst|adoc)$/i.test(hit.path)) return "doc";
  return "code";
}

export function primaryChannel(hit: Hit): RetrievalChannel {
  const lexical = (hit.lexicalScore ?? 0) * RETRIEVAL_WEIGHTS.lexical;
  const semantic = (hit.semanticScore ?? 0) * RETRIEVAL_WEIGHTS.semantic;
  const structural = (hit.structuralScore ?? 0) * RETRIEVAL_WEIGHTS.structural;
  if (semantic >= lexical && semantic >= structural && semantic > 0) return "semantic";
  if (structural > lexical && structural > 0) return "structural";
  return "lexical";
}

/** `7 hits | 4 semantic / 3 lexical | top: docs/API_DOCUMENTATION.md (doc, 0.81)` */
export function formatRetrievalSummary(hits: Hit[]): string {
  const counts = { semantic: 0, lexical: 0, structural: 0 };
  for (const hit of hits) counts[primaryChannel(hit)] += 1;
  const parts = [`${counts.semantic} semantic`, `${counts.lexical} lexical`];
  if (counts.structural > 0) parts.push(`${counts.structural} structural`);
  const top = hits[0];
  const topBit = top
    ? `top: ${top.path} (${evidenceTypeOf(top)}, ${Number(top.score.toFixed(2))})`
    : "top: none";
  return `${hits.length} hits | ${parts.join(" / ")} | ${topBit}`;
}
