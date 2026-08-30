export const PDF_LIMITS = {
  maxBytesPerPdf: 12 * 1024 * 1024,
  maxPagesPerPdf: 80,
  maxExtractedCharsPerPdf: 250_000,
  maxDocumentChunksPerPdf: 200,
  maxPdfBytesPerContext: 40 * 1024 * 1024,
  maxPdfPagesPerContext: 400,
  maxExtractedCharsPerContext: 1_500_000,
  maxDocumentChunksPerContext: 800,
  maxPdfsPerContext: 24,
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
