export const PDF_LIMITS = {
  maxBytesPerPdf: 25 * 1024 * 1024,
  maxPagesPerPdf: 600,
  maxExtractedCharsPerPdf: 2_000_000,
  maxDocumentChunksPerPdf: 2000,
  maxPdfBytesPerContext: 80 * 1024 * 1024,
  maxPdfPagesPerContext: 3000,
  maxExtractedCharsPerContext: 8_000_000,
  maxDocumentChunksPerContext: 6000,
  maxPdfsPerContext: 48,
  concurrentParse: 1,
} as const;

export type PdfParseLimits = {
  maxBytesPerPdf: number;
  maxPagesPerPdf: number;
  maxExtractedCharsPerPdf: number;
  maxPdfBytesPerContext: number;
  maxPdfPagesPerContext: number;
  maxExtractedCharsPerContext: number;
  maxPdfsPerContext: number;
};

export type ContextPdfUsage = {
  pdfBytes: number;
  pdfPages: number;
  extractedChars: number;
  pdfCount: number;
};

export function resolveLimits(overrides?: Partial<PdfParseLimits>): PdfParseLimits {
  return { ...PDF_LIMITS, ...overrides };
}
