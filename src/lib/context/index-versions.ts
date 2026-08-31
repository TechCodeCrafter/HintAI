/**
 * Bump these when the chunk representation or the retrieval index contract
 * changes. Cache hits require both to match the rows that were written.
 */
export const CHUNKER_VERSION = 1;
/**
 * Structured symbol chunks are implemented but off. Do not bump
 * CHUNKER_VERSION until this flips — cached window rows stay valid.
 */
export const USE_STRUCTURED_CHUNKER = false;
/**
 * Hybrid lexical + semantic retrieve is implemented but off. The live path
 * stays the existing synchronous IDF retrieve(). Do not flip until eval
 * shows equal-or-better safety (wrong-intent 0, unsupported 0).
 */
export const USE_HYBRID_RETRIEVAL = false;
/** Bump when the embedding model or pooling contract changes. */
export const EMBEDDING_VERSION = 1;
export const RETRIEVAL_INDEX_VERSION = 1;
export const STORED_CHUNK_SCHEMA = 1;

/** Must match the pinned `pdfjs-dist` version in package.json. */
export const PDFJS_DIST_VERSION = "6.3.289";
/** Bump when the pdfjs-dist pin or extract options change. */
export const PDF_PARSER_VERSION = 1;
/** Bump when join / column / header / dehyphenation rules change. */
export const DOCUMENT_NORMALIZER_VERSION = 3;
/** Bump when PDF chunk boundaries change. Not part of evidence currentness. */
export const DOCUMENT_CHUNKER_VERSION = 2;
/**
 * Derived layout IR only. Bump when VisualLine / region-candidate identity
 * or feature formulas change. Not part of evidence currentness.
 * 4A.9.2: production layout consumes the same dominant-prose analysis.
 * 4A.9.3: derived DocumentBlocks (paragraph/list/math/furniture). Not evidence.
 */
export const DOCUMENT_STRUCTURE_VERSION = 3;
