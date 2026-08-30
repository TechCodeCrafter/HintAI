import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../../context/index-versions.ts";
import type { PdfTerminalReadiness } from "../../context/types.ts";
import type { NormalizedDocument, NormalizedPage, PdfTextItem } from "../types.ts";
import { detectRepeatedBands } from "./headers.ts";
import { extractPdfItems } from "./items.ts";
import { groupVisualLines } from "./layout.ts";
import { type ContextPdfUsage, type PdfParseLimits, resolveLimits } from "./limits.ts";
import { normalizePage } from "./normalize.ts";
import { READINESS_NOTES } from "./notes.ts";
import { resolveOutline } from "./outline.ts";
import { openPdfDocument } from "./pdfjs.ts";

export type PdfParseInput = {
  contextId: string;
  sourceId: string;
  path: string;
  contentHash: string;
  blob: Blob;
};

export type PdfParseResult = {
  readiness: PdfTerminalReadiness;
  readinessNote: string;
  pageCount: number;
  extractedChars: number;
  document: NormalizedDocument;
};

export async function parsePdf(
  input: PdfParseInput,
  options?: { limits?: Partial<PdfParseLimits>; usage?: ContextPdfUsage },
): Promise<PdfParseResult> {
  const limits = resolveLimits(options?.limits);
  const usage = options?.usage;
  const bytes = input.blob.size;

  const refuse = (readinessNote: string, pageCount = 0): PdfParseResult =>
    terminal(input, "refused", readinessNote, pageCount, []);

  if (bytes > limits.maxBytesPerPdf) return refuse(READINESS_NOTES.refusedBytes);
  if (usage && usage.pdfCount >= limits.maxPdfsPerContext) return refuse(READINESS_NOTES.refusedContextCount);
  if (usage && usage.pdfBytes + bytes > limits.maxPdfBytesPerContext) {
    return refuse(READINESS_NOTES.refusedContextBytes);
  }

  let data: Uint8Array;
  try {
    data = new Uint8Array(await input.blob.arrayBuffer());
  } catch {
    return terminal(input, "unreadable", READINESS_NOTES.unreadable, 0, []);
  }

  let doc;
  try {
    doc = await openPdfDocument(data);
  } catch {
    return terminal(input, "unreadable", READINESS_NOTES.unreadable, 0, []);
  }

  try {
    const pageCount = doc.numPages;
    if (pageCount > limits.maxPagesPerPdf) {
      return refuse(READINESS_NOTES.refusedPages, pageCount);
    }
    if (usage && usage.pdfPages + pageCount > limits.maxPdfPagesPerContext) {
      return refuse(READINESS_NOTES.refusedContextPages, pageCount);
    }

    const extracted: Array<{ pageNumber: number; items: PdfTextItem[]; width: number; height: number }> = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const viewport = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      extracted.push({
        pageNumber,
        items: extractPdfItems(content.items),
        width: viewport.width,
        height: viewport.height,
      });
    }

    const skipBands = detectRepeatedBands(
      extracted.map((page) => ({ height: page.height, lines: groupVisualLines(page.items) })),
    );
    const pages: NormalizedPage[] = extracted.map((page) =>
      normalizePage({
        pageNumber: page.pageNumber,
        items: page.items,
        pageWidth: page.width,
        pageHeight: page.height,
        skipBands,
      }),
    );

    const extractedChars = pages.reduce((sum, page) => sum + page.text.length, 0);
    if (extractedChars > limits.maxExtractedCharsPerPdf) {
      return refuse(READINESS_NOTES.refusedChars, pageCount);
    }
    if (usage && usage.extractedChars + extractedChars > limits.maxExtractedCharsPerContext) {
      return refuse(READINESS_NOTES.refusedContextChars, pageCount);
    }

    const extractable = pages.filter((page) => page.usefulItemCount > 0);
    if (extractable.length === 0) {
      return terminal(input, "scanned", READINESS_NOTES.scanned, pageCount, pages, await resolveOutline(doc));
    }

    return terminal(input, "ready", undefined, pageCount, pages, await resolveOutline(doc));
  } catch {
    return terminal(input, "unreadable", READINESS_NOTES.unreadable, 0, []);
  } finally {
    try {
      await doc.cleanup();
    } catch {
      // ignore
    }
  }
}

function terminal(
  input: PdfParseInput,
  readiness: PdfTerminalReadiness,
  readinessNote: string | undefined,
  pageCount: number,
  pages: NormalizedPage[],
  outline: NormalizedDocument["outline"] = [],
): PdfParseResult {
  const extractedChars = pages.reduce((sum, page) => sum + page.text.length, 0);
  return {
    readiness,
    readinessNote: readinessNote ?? (readiness === "ready" ? "" : READINESS_NOTES.unreadable),
    pageCount,
    extractedChars,
    document: {
      contextId: input.contextId,
      sourceId: input.sourceId,
      path: input.path,
      contentHash: input.contentHash,
      type: "pdf",
      parserVersion: PDF_PARSER_VERSION,
      normalizerVersion: DOCUMENT_NORMALIZER_VERSION,
      pageCount,
      outline,
      pages: readiness === "refused" || readiness === "unreadable" ? [] : pages,
      readiness,
      readinessNote,
    },
  };
}
