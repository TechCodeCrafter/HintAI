import { PDF_LIMITS } from "./limits.ts";
import { READINESS_NOTES } from "./notes.ts";

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF

export type PdfAcceptReason =
  | "ok"
  | "not-pdf"
  | "too-large"
  | "context-count"
  | "context-bytes";

export type PdfAcceptResult = {
  ok: boolean;
  reason: PdfAcceptReason;
  note: string;
};

export function hasPdfExtension(name: string): boolean {
  return name.toLowerCase().endsWith(".pdf");
}

/** First bytes must be `%PDF`. MIME and `.pdf` names are not enough. */
export async function looksLikePdf(blob: Blob): Promise<boolean> {
  if (blob.size < PDF_MAGIC.length) return false;
  const head = new Uint8Array(await blob.slice(0, PDF_MAGIC.length).arrayBuffer());
  return PDF_MAGIC.every((byte, index) => head[index] === byte);
}

export async function acceptPdfFile(
  file: File,
  usage: { pdfCount: number; pdfBytes: number; replacingExisting: boolean },
  limits = PDF_LIMITS,
): Promise<PdfAcceptResult> {
  if (!hasPdfExtension(file.name)) {
    return { ok: false, reason: "not-pdf", note: "Only PDF files can be added here." };
  }
  if (!(await looksLikePdf(file))) {
    return { ok: false, reason: "not-pdf", note: "That file is not a readable PDF." };
  }
  if (file.size > limits.maxBytesPerPdf) {
    return { ok: false, reason: "too-large", note: READINESS_NOTES.refusedBytes };
  }
  if (!usage.replacingExisting && usage.pdfCount >= limits.maxPdfsPerContext) {
    return { ok: false, reason: "context-count", note: READINESS_NOTES.refusedContextCount };
  }
  const nextBytes = usage.replacingExisting ? usage.pdfBytes : usage.pdfBytes + file.size;
  if (nextBytes > limits.maxPdfBytesPerContext) {
    return { ok: false, reason: "context-bytes", note: READINESS_NOTES.refusedContextBytes };
  }
  return { ok: true, reason: "ok", note: "" };
}
