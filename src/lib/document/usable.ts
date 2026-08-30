import { DOCUMENT_NORMALIZER_VERSION, PDF_PARSER_VERSION } from "../context/index-versions.ts";
import type { NormalizedDocument } from "./types.ts";

/** Cached IR is usable only when parser and normalizer versions still match. */
export function cachedDocumentIsCurrent(
  document: NormalizedDocument | null | undefined,
): document is NormalizedDocument {
  if (!document) return false;
  return (
    document.parserVersion === PDF_PARSER_VERSION && document.normalizerVersion === DOCUMENT_NORMALIZER_VERSION
  );
}
