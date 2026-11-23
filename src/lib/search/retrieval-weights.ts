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
  /**
   * What a path or file-name match keeps when the chunk's text backs none of
   * the rest of the question. `app.ts` sharing the word "app" is a hint, not
   * evidence. See `nameCredit` in retrieve.ts.
   */
  nameOnlyCredit: 0.15,
  /**
   * Share of the question (by IDF weight) a chunk's text has to cover before
   * the entry-point boost or the docs bonus counts in full.
   */
  backingShare: 0.5,
  /**
   * The chunk declares an identifier the question names ("verifyClaim" and
   * `export function verifyClaim`). The question named this place, so it is
   * worth what a named file is worth (`pathMatch`).
   *
   * In the lexical channel the declaring chunk's text is first raised to the
   * best text match in the material (`symbolLift` in the debug log), and this
   * is added on top. So a declaration outranks a chunk that only mentions the
   * symbol, however often: the kind-of-file bonuses a mention can still
   * collect (exact phrase 3, behavior path 2.6, file head 1.6, lambda fleet
   * 3.4) come to less than this. Keep it above their sum. Only a path score
   * can compete: a file the question names. For the same question the README,
   * docs and entry-point bonuses are switched off: see `namesCode` in
   * retrieve.ts.
   */
  symbolDefinition: 12,
  /** Structured-chunk symbol overlap, hybrid traces and hybrid addend. */
  symbolMatch: 2.0,
  /**
   * Structural channel: the question's words are in the heading a chunk sits
   * under (a section or slide title, a spreadsheet's column names, an XML
   * element path, a PDF section). This is what a chunk gets when the heading
   * holds every word of the question; it is scaled down by the share it holds.
   */
  headingMatch: 1.5,
  /**
   * Lexical channel: a question word that is in a chunk's heading and not in
   * its text, as a multiplier on the IDF term weight. Below what the same word
   * is worth in the text itself (1.6), so a row or a paragraph that says the
   * word still outranks one that only sits under it.
   */
  headingTerm: 1.2,
  /**
   * Lexical channel: a question word that is part of a name the chunk
   * declares ("backoff" and `function retryBackoff`), as a multiplier on the
   * IDF term weight. The chunk already scores the word in its text (1.6); this
   * is what separates the definition from a chunk that calls or mentions it.
   * Below `headingTerm`, and far below `symbolDefinition`, which is for a
   * question that writes the identifier out. Source code only.
   */
  declaredTerm: 1.0,
  /**
   * Lexical channel: the most a chunk gets for sitting in a file the newest
   * commit changed. It falls to 0 for a file last changed 30 commits back, and
   * is scaled by how much of the question the chunk's text covers, so a file
   * that does not match the question gets nothing. A tie-breaker: under one
   * question word found in the text of a chunk (1.6 at an IDF weight of 1).
   * Only present when the loaded folder had a readable `.git`.
   */
  recentCommit: 1.0,
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
  /** Docs, contracts, and architecture/security paths rank above tests/examples. */
  authoritativePath: 3,
  /**
   * Behavior questions ("what does X do", "how does X work", "what happens
   * after X") are answered by the component that performs the behavior, not by
   * the HTTP route that triggers it. Route handlers describe the API surface;
   * services/workers/lambdas describe the system. Boost the behavior files.
   */
  behaviorPath: 2.6,
  /** Uploaded docs/slides — not code paths, but primary evidence for definition questions. */
  documentPath: 2.4,
  /** "What is X?" against slide/deck/doc filenames and bodies. */
  documentDefinition: 2.8,
  semanticFloor: 0.3,
  semanticScale: 10,
  /**
   * Hard cap on chunks from one file in the results handed to the composer and
   * the model. One long file (usually the README) cannot fill the top-k and
   * leave no room for the file that holds the detail. See `capPerFile`.
   */
  maxChunksPerFile: 2,
};

export function combineScores(lexical: number, semantic: number, structural = 0): number {
  return (
    lexical * RETRIEVAL_WEIGHTS.lexical +
    semantic * RETRIEVAL_WEIGHTS.semantic +
    structural * RETRIEVAL_WEIGHTS.structural
  );
}
