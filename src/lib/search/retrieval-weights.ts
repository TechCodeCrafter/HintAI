/**
 * The one place retrieval scores are tuned.
 *
 * `pathMatch` / `filenameMatch` / `apiShapePath` / `fileHead` are the live
 * lexical addends. Changing them changes `retrieve()` and needs an eval.
 * `lexical` / `semantic` are used only by `combineScores` on the hybrid path.
 */
export const RETRIEVAL_WEIGHTS = {
  lexical: 1.0,
  semantic: 0.8,
  /** Existing named-path addend in retrieve() (`flow.ts` in the question). */
  pathMatch: 12,
  /** Existing filename / stem multiplier on the IDF term weight. */
  filenameMatch: 4,
  /** Structured-chunk symbol overlap, hybrid traces and hybrid addend. */
  symbolMatch: 2.0,
  /** Document heading overlap (hybrid signal). */
  headingMatch: 1.5,
  /** Query phrase appears verbatim in the chunk. */
  exactPhrase: 3.0,
  apiShapePath: 3.4,
  fileHead: 1.6,
  semanticFloor: 0.3,
  semanticScale: 10,
};

export function combineScores(lexical: number, semantic: number): number {
  return lexical * RETRIEVAL_WEIGHTS.lexical + semantic * RETRIEVAL_WEIGHTS.semantic;
}
