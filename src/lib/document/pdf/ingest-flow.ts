import { indexContext, type IndexedRuntime } from "../../context/chunk-index.ts";
import type { ContextRepository } from "../../context/repository.ts";
import { contextStatusFor, pdfWorkPending } from "../../context/source-write.ts";
import {
  isPdfSource,
  isTextSource,
  type PdfStoredSource,
  type StoredSource,
} from "../../context/types.ts";
import { parseAndPersistPdf } from "./ingest.ts";

export type IngestItemState = "waiting" | "reading" | "indexing" | "ready" | "scanned" | "unreadable" | "refused";

export type IngestProgress = {
  total: number;
  current: number;
  phase: "reading" | "indexing" | "ready";
  items: Array<{ path: string; state: IngestItemState }>;
};

export type IngestFlowResult = {
  runtime: IndexedRuntime | null;
  sources: StoredSource[];
  cancelled: boolean;
};

/**
 * True when this Context already has a complete searchable snapshot
 * (text files, or a terminal active PDF revision). Search may keep
 * serving that snapshot while a staged update finishes.
 */
export function canServeSnapshot(sources: StoredSource[]): boolean {
  if (sources.some(isTextSource)) return true;
  return sources.some((source) => {
    if (!isPdfSource(source)) return false;
    if (source.readiness === "pending") return false;
    if (source.readiness === "ready" && !source.chunked) return false;
    return true;
  });
}

export function pendingPdfSources(sources: StoredSource[]): PdfStoredSource[] {
  return sources.filter((source): source is PdfStoredSource => {
    if (!isPdfSource(source)) return false;
    if (source.stagedContentHash && (!source.stagedReadiness || source.stagedReadiness === "pending")) {
      return true;
    }
    return source.readiness === "pending" && !source.stagedContentHash;
  });
}

/**
 * Parse pending/staged PDFs one at a time, index, then activate.
 * Persistence always finishes for this contextId. The caller must not
 * apply the runtime when `cancelled` is true.
 */
export async function finishPdfIngest(
  repo: ContextRepository,
  contextId: string,
  options: {
    isCancelled?: () => boolean;
    onProgress?: (progress: IngestProgress) => void;
  } = {},
): Promise<IngestFlowResult> {
  const report = (phase: IngestProgress["phase"], current: number, sources: StoredSource[]) => {
    const pending = pendingPdfSources(sources);
    const items = sources.filter(isPdfSource).map((source) => ({
      path: source.path,
      state: itemState(source, pending),
    }));
    options.onProgress?.({
      total: Math.max(pending.length, items.filter((item) => item.state !== "ready").length),
      current,
      phase,
      items,
    });
  };

  await repo.beginContextActivation(contextId);
  let sources = await repo.listSources(contextId);
  const queue = pendingPdfSources(sources);
  let current = 0;

  for (const source of queue) {
    current += 1;
    report("reading", current, markReading(sources, source.id));
    await parseAndPersistPdf(repo, contextId, source);
    sources = await repo.listSources(contextId);
    if (options.isCancelled?.()) {
      // Persist the rest so reload recovery is deterministic, but do not
      // apply a runtime for a Context that is no longer on screen.
    }
  }

  report("indexing", Math.max(current, 1), sources);
  const first = await indexContext(repo, contextId, {
    isCancelled: options.isCancelled,
  });
  await repo.completeContextActivation(contextId);
  sources = await repo.listSources(contextId);

  if (options.isCancelled?.() || first.cancelled) {
    return { runtime: null, sources, cancelled: true };
  }

  const runtime = pdfWorkPending(sources)
    ? first
    : await indexContext(repo, contextId, { isCancelled: options.isCancelled });
  sources = await repo.listSources(contextId);
  if (options.isCancelled?.() || runtime.cancelled) {
    return { runtime: null, sources, cancelled: true };
  }

  report("ready", queue.length, sources);
  return { runtime, sources, cancelled: false };
}

/**
 * Reload / activate recovery: resume from canonical staged Blobs, or
 * serve the previous snapshot if it is already complete.
 */
export async function resumePdfWork(
  repo: ContextRepository,
  contextId: string,
  options: {
    isCancelled?: () => boolean;
    onProgress?: (progress: IngestProgress) => void;
  } = {},
): Promise<IngestFlowResult> {
  const sources = await repo.listSources(contextId);
  if (!pdfWorkPending(sources)) {
    const runtime = await indexContext(repo, contextId, { isCancelled: options.isCancelled });
    return {
      runtime: runtime.cancelled ? null : runtime,
      sources,
      cancelled: runtime.cancelled,
    };
  }
  return finishPdfIngest(repo, contextId, options);
}

export function snapshotStatus(sources: StoredSource[]): "indexing" | "ready" {
  return contextStatusFor(sources);
}

function itemState(source: PdfStoredSource, pending: PdfStoredSource[]): IngestItemState {
  if (pending.some((row) => row.id === source.id && row.readiness === "pending" && !row.stagedReadiness)) {
    return source.stagedContentHash && source.stagedReadiness === "pending" ? "reading" : "waiting";
  }
  if (source.stagedContentHash && (!source.stagedReadiness || source.stagedReadiness === "pending")) {
    return "reading";
  }
  if (source.readiness === "pending") return "waiting";
  if (source.readiness === "ready") return source.chunked ? "ready" : "indexing";
  return source.readiness;
}

function markReading(sources: StoredSource[], sourceId: string): StoredSource[] {
  return sources.map((source) => {
    if (!isPdfSource(source) || source.id !== sourceId) return source;
    if (source.stagedContentHash) {
      return { ...source, stagedReadiness: source.stagedReadiness ?? "pending" };
    }
    return source;
  });
}
