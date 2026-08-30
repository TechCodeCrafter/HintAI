import type { ContextRepository } from "../../context/repository.ts";
import { isPdfSource, type PdfSourceDraft, type StoredSource } from "../../context/types.ts";
import { normalizePath } from "../../context/storage/schema.ts";
import { acceptPdfFile } from "./accept.ts";
import { contextNameForPdfs } from "./source-status.ts";
import { contextPdfUsage } from "./usage.ts";
import { canServeSnapshot, finishPdfIngest, type IngestFlowResult, type IngestProgress } from "./ingest-flow.ts";

/**
 * Duplicate display names in one picker batch are rejected (policy A).
 * mergeUpsert would silently skip the later file; the UI must not.
 */
export const DUPLICATE_NAME_NOTE = "Another selected file already uses this name.";

export type PdfBatchItem =
  | { file: File; path: string; draft: PdfSourceDraft }
  | { file: File; path: string; rejected: true; note: string };

export type PdfBatchPlan = {
  accepted: Array<{ file: File; path: string; draft: PdfSourceDraft }>;
  rejected: Array<{ file: File; path: string; note: string }>;
  contextName: string;
};

export async function planPdfBatch(files: File[], existing: StoredSource[]): Promise<PdfBatchPlan> {
  const usage = contextPdfUsage(existing);
  const seen = new Set<string>();
  const accepted: PdfBatchPlan["accepted"] = [];
  const rejected: PdfBatchPlan["rejected"] = [];
  let plannedCount = usage.pdfCount;
  let plannedBytes = usage.pdfBytes;

  for (const file of files) {
    const path = normalizePath(file.name);
    if (!path) {
      rejected.push({ file, path: file.name, note: "That file has no name." });
      continue;
    }
    if (seen.has(path)) {
      rejected.push({ file, path, note: DUPLICATE_NAME_NOTE });
      continue;
    }
    seen.add(path);

    const prior = existing.find((row) => row.path === path);
    const replacingExisting = Boolean(prior && isPdfSource(prior));
    const result = await acceptPdfFile(file, {
      pdfCount: plannedCount,
      pdfBytes: plannedBytes,
      replacingExisting,
    });
    if (!result.ok) {
      rejected.push({ file, path, note: result.note });
      continue;
    }
    if (!replacingExisting) {
      plannedCount += 1;
      plannedBytes += file.size;
    }
    accepted.push({
      file,
      path,
      draft: { path, kind: "pdf", mimeType: "application/pdf", blob: file },
    });
  }

  return {
    accepted,
    rejected,
    contextName: contextNameForPdfs(accepted.map((item) => item.file)),
  };
}

export type AddPdfFilesResult = {
  contextId: string | null;
  created: boolean;
  hadSnapshot: boolean;
  plan: PdfBatchPlan;
  ingest: IngestFlowResult | null;
  quotaFailed: boolean;
};

/**
 * Create-or-upsert + parse + activate. Persistence always targets the
 * chosen contextId. The caller applies runtime only when it is still active.
 */
export async function addPdfFilesToContext(
  repo: ContextRepository,
  files: File[],
  existingContextId: string | null,
  options: {
    isCancelled?: () => boolean;
    onProgress?: (progress: IngestProgress) => void;
  } = {},
): Promise<AddPdfFilesResult> {
  const existingSources = existingContextId ? await repo.listSources(existingContextId) : [];
  const plan = await planPdfBatch(files, existingSources);
  if (plan.accepted.length === 0) {
    return {
      contextId: existingContextId,
      created: false,
      hadSnapshot: Boolean(existingContextId) && canServeSnapshot(existingSources),
      plan,
      ingest: null,
      quotaFailed: false,
    };
  }

  let contextId = existingContextId;
  let created = false;
  const hadSnapshot = Boolean(contextId) && canServeSnapshot(existingSources);
  if (!contextId) {
    const context = await repo.createContext({ name: plan.contextName });
    contextId = context.id;
    created = true;
  }

  try {
    await repo.upsertSources(
      contextId,
      plan.accepted.map((item) => item.draft),
    );
  } catch {
    return { contextId, created, hadSnapshot, plan, ingest: null, quotaFailed: true };
  }

  const ingest = await finishPdfIngest(repo, contextId, options);
  return { contextId, created, hadSnapshot, plan, ingest, quotaFailed: false };
}
