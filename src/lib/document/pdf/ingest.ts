import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../../context/index-versions.ts";
import type { ContextRepository } from "../../context/repository.ts";
import { parseHashOf } from "../../context/source-write.ts";
import { isPdfSource, type PdfStoredSource } from "../../context/types.ts";
import type { NormalizedDocument } from "../types.ts";
import type { PdfParseLimits } from "./limits.ts";
import { READINESS_NOTES } from "./notes.ts";
import { parsePdf, type PdfParseResult } from "./parse.ts";
import { enqueuePdfParse } from "./queue.ts";
import { contextPdfUsage } from "./usage.ts";

/**
 * Parse one PDF revision and persist IR + terminal source state.
 * Does not swap a staged hash onto the active snapshot.
 */
export async function parseAndPersistPdf(
  repo: ContextRepository,
  contextId: string,
  source: PdfStoredSource,
  options?: { limits?: Partial<PdfParseLimits> },
): Promise<PdfParseResult> {
  return enqueuePdfParse(async () => {
    const contentHash = parseHashOf(source);
    const blob = await repo.getSourceBlob(source.id, contentHash);
    if (!blob) {
      const document = stubDocument(contextId, source, contentHash);
      const result: PdfParseResult = {
        readiness: "unreadable",
        readinessNote: READINESS_NOTES.unreadable,
        pageCount: 0,
        extractedChars: 0,
        document,
      };
      await repo.applyPdfParseResult(contextId, source.id, contentHash, {
        readiness: "unreadable",
        readinessNote: READINESS_NOTES.unreadable,
        pageCount: 0,
        extractedChars: 0,
        document,
      });
      return result;
    }
    const sources = await repo.listSources(contextId);
    const usage = contextPdfUsage(sources, source.id);
    const result = await parsePdf(
      {
        contextId,
        sourceId: source.id,
        path: source.path,
        contentHash,
        blob,
      },
      { limits: options?.limits, usage },
    );
    await repo.applyPdfParseResult(contextId, source.id, contentHash, {
      readiness: result.readiness,
      readinessNote: result.readinessNote || undefined,
      pageCount: result.pageCount,
      byteLength: blob.size,
      extractedChars: result.extractedChars,
      document: result.document,
    });
    return result;
  });
}

export async function parsePendingPdfs(
  repo: ContextRepository,
  contextId: string,
  options?: { limits?: Partial<PdfParseLimits> },
): Promise<PdfParseResult[]> {
  const sources = await repo.listSources(contextId);
  const results: PdfParseResult[] = [];
  for (const source of sources) {
    if (!isPdfSource(source)) continue;
    const needsParse =
      source.stagedContentHash && !source.stagedReadiness
        ? true
        : source.readiness === "pending" && !source.stagedContentHash;
    if (!needsParse) continue;
    results.push(await parseAndPersistPdf(repo, contextId, source, options));
  }
  return results;
}

function stubDocument(contextId: string, source: PdfStoredSource, contentHash: string): NormalizedDocument {
  return {
    contextId,
    sourceId: source.id,
    path: source.path,
    contentHash,
    type: "pdf",
    parserVersion: PDF_PARSER_VERSION,
    normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
    pageCount: 0,
    outline: [],
    pages: [],
    readiness: "unreadable",
    readinessNote: READINESS_NOTES.unreadable,
  };
}
