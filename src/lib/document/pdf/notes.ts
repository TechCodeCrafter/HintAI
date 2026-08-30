export const READINESS_NOTES = {
  scanned: "This PDF appears to contain scanned pages. MeetHint cannot read scanned PDFs yet.",
  unreadable: "This PDF could not be read.",
  refusedBytes: "This PDF is too large to index.",
  refusedPages: "This PDF has too many pages to index.",
  refusedChars: "This PDF has too much extracted text to index.",
  refusedContextBytes: "This context is at its PDF size limit.",
  refusedContextPages: "This context is at its PDF page limit.",
  refusedContextCount: "This context is at its PDF file limit.",
  refusedContextChars: "This context is at its extracted-text limit.",
  refusedChunks: "This PDF produced too many passages to index.",
  refusedContextChunks: "This context is at its passage limit.",
} as const;
