/**
 * Why a retrieved chunk scored what it did. Diagnostic only — composition
 * never reads these. Mirrors claim-trace: a silent log the eval can dump.
 */

export type RetrievalTrace = {
  chunkId: string;
  lexicalScore: number;
  semanticScore: number;
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
