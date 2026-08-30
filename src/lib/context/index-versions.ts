/**
 * Bump these when the chunk representation or the retrieval index contract
 * changes. Cache hits require both to match the rows that were written.
 */
export const CHUNKER_VERSION = 1;
export const RETRIEVAL_INDEX_VERSION = 1;
export const STORED_CHUNK_SCHEMA = 1;

/** Must match the pinned `pdfjs-dist` version in package.json. */
export const PDFJS_DIST_VERSION = "6.3.289";
/** Bump when the pdfjs-dist pin or extract options change. */
export const PDF_PARSER_VERSION = 1;
/** Bump when join / column / header / dehyphenation rules change. */
export const DOCUMENT_NORMALIZER_VERSION = 2;
/** Bump when PDF chunk boundaries change. Not part of evidence currentness. */
export const DOCUMENT_CHUNKER_VERSION = 1;
