/**
 * Whether search is prepared for a question, and what that means for Listen.
 *
 * Opening a space leaves two things to do before a question can be answered
 * at full speed: the word index is built for every chunk, and the space's
 * vectors are read into memory (with the model that embeds a question loaded
 * beside them). `warm.ts` does that work and reports it as a `SearchWarmth`.
 * Everything here is a pure reading of that report, so the chip, the Listen
 * button and the search path cannot disagree about what "ready" is.
 */

/**
 * Where the vector channel stands for the chunks in use.
 *
 * off: these chunks have no vectors to wait for (no vector store on this
 *   device, or material that is never embedded). Search runs as it always has.
 * warming: vectors are being read or written and may still arrive in time.
 * ready: every vector is in memory and a question can be embedded. Hybrid.
 * lexical: the wait for vectors is over and they are not ready. Questions are
 *   ranked on words and structure, and each Card says so, until they are.
 */
export type VectorWarmState = "off" | "warming" | "ready" | "lexical";

export type SearchWarmth = {
  /** The word index: how many chunks have their words indexed. */
  words: { done: number; total: number; ready: boolean };
  /** The vector channel: how many chunks have a vector in memory. */
  vectors: { state: VectorWarmState; have: number; total: number };
};

/** What is still being prepared. "ready" means a question is answered at full speed. */
export type WarmPhase = "words" | "vectors" | "ready";

/** Nothing prepared yet for a set of `total` chunks. An empty set has nothing to prepare. */
export function pendingWarmth(total: number, expectsVectors: boolean): SearchWarmth {
  const vectors = expectsVectors && total > 0;
  return {
    words: { done: 0, total, ready: total === 0 },
    vectors: { state: vectors ? "warming" : "off", have: 0, total: vectors ? total : 0 },
  };
}

export function warmPhase(warmth: SearchWarmth): WarmPhase {
  if (!warmth.words.ready) return "words";
  if (warmth.vectors.state === "warming") return "vectors";
  return "ready";
}

/** True once the vectors were given up on for now and search runs on words and structure. */
export function onLexicalPath(warmth: SearchWarmth): boolean {
  return warmth.vectors.state === "lexical";
}

export type SearchMode = {
  /** False leaves the vector channel out: no vector is read, the question is not embedded. */
  semantic: boolean;
  /** True when vectors were expected for this material and the question could not wait for them. */
  lexicalOnly: boolean;
};

/**
 * How the next question is ranked. Decided per question, from the warmth at
 * the moment it is asked, so the first question after the vectors finish is
 * hybrid without anything being switched by hand.
 *
 * `null` is material nothing has reported on; it is searched as it always was.
 */
export function searchModeFor(warmth: SearchWarmth | null): SearchMode {
  const state = warmth?.vectors.state ?? "off";
  if (state === "warming" || state === "lexical") return { semantic: false, lexicalOnly: true };
  return { semantic: true, lexicalOnly: false };
}

/** Marks a Card answered without the vector channel. Leaves every other Card as it is. */
export function markLexicalOnly<T extends { lexicalOnly?: boolean }>(card: T, mode: SearchMode): T {
  return mode.lexicalOnly ? { ...card, lexicalOnly: true } : card;
}

/** The short line a Card answered on the lexical path carries. */
export const LEXICAL_ONLY_NOTE = "Word search only";

/** The same, in a sentence, for the tooltip. */
export const LEXICAL_ONLY_DETAIL =
  "Ranked on words and structure only. The vectors for this space were still warming, so meaning-based ranking was left out. The next question uses it once they are ready.";

export type ListenGate = {
  /** True when clicking Listen starts a session that is fully prepared. */
  ready: boolean;
  /** Why Listen is off, in a sentence. Null when it is on. */
  reason: string | null;
};

/**
 * Listen is on exactly when the index chip reports Ready: no load or re-index
 * is running, the last one did not fail, there is something to search, the
 * word index is built, and the vectors are either in memory or given up on
 * for now (the lexical path).
 */
export function listenGate(input: {
  /** A load, a re-index or a PDF read is running. */
  working: boolean;
  /** The last load ended in an error. */
  errored: boolean;
  /** At least one chunk can be searched. */
  searchable: boolean;
  warmth: SearchWarmth;
}): ListenGate {
  if (input.working) return { ready: false, reason: "Indexing is still running. Listen turns on when the index is ready." };
  if (input.errored) return { ready: false, reason: "Indexing did not finish. Reload, or add the material again." };
  if (!input.searchable) return { ready: false, reason: "Nothing is indexed yet. Add files, then listen." };
  const phase = warmPhase(input.warmth);
  if (phase === "words") return { ready: false, reason: "Indexing words. Listen turns on when the index is ready." };
  if (phase === "vectors") return { ready: false, reason: "Warming vectors. Listen turns on in a moment." };
  return { ready: true, reason: null };
}

/**
 * Whether adding files re-indexes behind the session in progress.
 *
 * True when the files join the space that is open and already searchable:
 * the material in use stays in place, questions keep being answered from it,
 * and the new index replaces it in one step when it is ready. False when the
 * add opens a different space or the open one has nothing to keep.
 */
export function addKeepsSession(input: { sameSpace: boolean; status: string; sourceCount: number }): boolean {
  return input.sameSpace && input.status === "ready" && input.sourceCount > 0;
}
