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
  /** Structural / path / symbol channel in hybridRetrieve. */
  structural: 0.6,
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
  /**
   * Test/fixture files describe what the suite *covers*, not what the system
   * *does*. When a real source file is absent or under-documented, a test
   * docstring that mentions the subject otherwise becomes the top hit and is
   * spoken as a confident wrong answer ("What does the session service do?"
   * answered by `test_shared_bda_service.py`). Demote hard enough that a test
   * file only wins when nothing else matches at all.
   */
  testPathPenalty: 9,
  /**
   * Behavior questions ("what does X do", "how does X work", "what happens
   * after X") are answered by the component that performs the behavior, not by
   * the HTTP route that triggers it. Route handlers describe the API surface;
   * services/workers/lambdas describe the system. Boost the behavior files.
   */
  behaviorPath: 2.6,
  semanticFloor: 0.3,
  semanticScale: 10,
};

export function combineScores(lexical: number, semantic: number, structural = 0): number {
  return (
    lexical * RETRIEVAL_WEIGHTS.lexical +
    semantic * RETRIEVAL_WEIGHTS.semantic +
    structural * RETRIEVAL_WEIGHTS.structural
  );
}
