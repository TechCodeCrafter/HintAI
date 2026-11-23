/**
 * Bump these when the chunk representation or the retrieval index contract
 * changes. Cache hits require both to match the rows that were written.
 */
/**
 * 3: Word documents, slide decks, spreadsheets and XML are cut on their own
 * structure (`format-chunks.ts`) and carry a `heading`. Code is unchanged, but
 * the version is one number for every file, so each stored file is re-chunked
 * once from its stored text. Nothing is re-read from disk.
 */
export const CHUNKER_VERSION = 3;
/**
 * Structured symbol chunks are implemented but off. Flipping this needs a
 * CHUNKER_VERSION bump of its own, or cached window rows stay in use.
 *
 * Off for a measured reason. The structured chunker emits one chunk per
 * parsed symbol and nothing for the text between symbols, and the regex
 * parser ends some symbols early. Over `src/lib/search` and `src/lib/context`
 * (70 files) 67% of non-blank lines fell inside a chunk; the rest, including
 * about 2,800 lines of code that are not imports, comments or closing braces,
 * were in no chunk and could not be searched or cited. Line windows cover
 * every line. Before this flips, the gaps between symbols need their own
 * chunks and answer quality needs an eval; it also makes about 3.6 times as
 * many chunks to embed.
 */
export const USE_STRUCTURED_CHUNKER = false;
/**
 * Hybrid lexical + semantic + structural retrieve. Embeddings are computed
 * lazily at index time. A failed embed degrades to lexical retrieve.
 */
export const USE_HYBRID_RETRIEVAL = true;
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
/**
 * Bump when PDF chunk boundaries or headings change. Not part of evidence currentness.
 * 3: a chunk's heading is the nearest heading above it on its page, then the
 * outline section its page is in.
 */
export const DOCUMENT_CHUNKER_VERSION = 3;
/**
 * Derived layout IR only. Bump when VisualLine / region-candidate identity
 * or feature formulas change. Not part of evidence currentness.
 * 4A.9.2: production layout consumes the same dominant-prose analysis.
 * 4A.9.3: derived DocumentBlocks (paragraph/list/math/furniture). Not evidence.
 * 4: the first line of a page or column can be a heading.
 */
export const DOCUMENT_STRUCTURE_VERSION = 4;
