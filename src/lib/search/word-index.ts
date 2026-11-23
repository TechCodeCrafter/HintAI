/**
 * The words of a chunk, stored compactly.
 *
 * Ranking asks one thing of a chunk, over and over: how often does it hold
 * this word, a word with the same stem, or a word one typo away. That used to
 * be a `Map<string, number>` per chunk, with every word a string of its own.
 * At 50,000 chunks the maps alone were about 600 MB, and a typo lookup walked
 * every word of every chunk on every question.
 *
 * Here each distinct word gets one integer for the whole session. A chunk
 * keeps two typed arrays: the ids of its words in ascending order, and how
 * often each occurs. A lookup is a binary search. A typo is resolved once per
 * question against the list of distinct words, not once per chunk.
 *
 * The counts are the same counts as before, so every score built on them is
 * the same number as before.
 */

/**
 * Light suffix stripping so "retrieval" reaches "retrieve" and "captions"
 * reaches "caption". Deliberately shallow: aggressive stemming collides more
 * than it helps on identifier-heavy text.
 */
export function stemOf(word: string): string {
  const cut = word.replace(/(ational|ization|ations|ition|ment|ness)$/, "").replace(/(ing|ed|es|s|al|ly)$/, "");
  const base = cut.length >= 3 ? cut : word;
  return base.endsWith("e") && base.length > 3 ? base.slice(0, -1) : base;
}

/** True when a and b differ by exactly one insertion/deletion/substitution. */
export function isEditDistanceOne(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (la === lb) {
      i += 1;
      j += 1;
    } else if (la > lb) {
      i += 1;
    } else {
      j += 1;
    }
  }
  edits += la - i + (lb - j);
  return edits <= 1;
}

/** Words shorter than this are never matched by a typo, on either side. */
const TYPO_MIN = 5;
const UNKNOWN = -2;
const NONE = -1;
/** A count is kept in 16 bits. A word repeated more often in one chunk is held at this. */
const MAX_COUNT = 0xffff;

/**
 * Every distinct word seen so far, and its id. Stems are words too, under a
 * "~" prefix no real word can have: "~retry" is "some word that stems to
 * retry", counted apart from the word "retry" itself.
 */
let ids = new Map<string, number>();
let words: string[] = [];
/** Word id to the id of its "~stem" entry. NONE when the word is its own stem. */
let stems: number[] = [];
/** Plain words of at least `TYPO_MIN` letters, by length, for typo lookups. */
let byLength: number[][] = [];
let generation = 0;
let limit = 2_000_000;

/**
 * Changes when the vocabulary is thrown away. Anything built from word ids
 * before that must be rebuilt.
 */
export function vocabularyGeneration(): number {
  return generation;
}

export function vocabularySize(): number {
  return words.length;
}

/**
 * The vocabulary only grows: words from a folder that was removed stay in it.
 * That is bounded by how many distinct words a person loads in one sitting,
 * and this is the valve for the case where it is not. Call it between
 * searches, never during one.
 */
export function trimVocabulary(): void {
  if (words.length <= limit) return;
  ids = new Map();
  words = [];
  stems = [];
  byLength = [];
  terms.clear();
  generation += 1;
  // If one set of material is this large by itself, do not rebuild on every search.
  limit *= 2;
}

function idOf(word: string): number {
  let id = ids.get(word);
  if (id !== undefined) return id;
  id = words.length;
  ids.set(word, id);
  words.push(word);
  stems.push(UNKNOWN);
  if (word.length >= TYPO_MIN && word.charCodeAt(0) !== 126) (byLength[word.length] ??= []).push(id);
  return id;
}

function stemIdOf(id: number): number {
  let stem = stems[id];
  if (stem === UNKNOWN) {
    const word = words[id];
    const cut = stemOf(word);
    stem = cut !== word ? idOf(`~${cut}`) : NONE;
    stems[id] = stem;
  }
  return stem;
}

/** The words of one piece of text: ids ascending, and the count of each. */
export type Bag = { ids: Uint32Array; counts: Uint16Array };

export const NO_WORDS: Bag = { ids: new Uint32Array(0), counts: new Uint16Array(0) };

/** Counts each word, and each word's stem when it differs from the word. */
export function bagOf(list: string[]): Bag {
  if (list.length === 0) return NO_WORDS;
  const tally = new Map<number, number>();
  for (const word of list) {
    const id = idOf(word);
    tally.set(id, (tally.get(id) ?? 0) + 1);
    const stem = stemIdOf(id);
    if (stem !== NONE) tally.set(stem, (tally.get(stem) ?? 0) + 1);
  }
  const sorted = Uint32Array.from(tally.keys()).sort();
  const counts = new Uint16Array(sorted.length);
  for (let i = 0; i < sorted.length; i += 1) counts[i] = Math.min(MAX_COUNT, tally.get(sorted[i]) ?? 0);
  return { ids: sorted, counts };
}

/** How often the word with this id is in the bag. */
export function countOf(bag: Bag, id: number): number {
  const list = bag.ids;
  let low = 0;
  let high = list.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    const at = list[mid];
    if (at === id) return bag.counts[mid];
    if (at < id) low = mid + 1;
    else high = mid - 1;
  }
  return 0;
}

/** A question word, resolved against the vocabulary. */
export type Term = {
  text: string;
  /** Id of the word itself, or NONE when no indexed text has it. */
  exact: number;
  /** Id of "~stem" for this word's stem, or NONE. */
  stem: number;
  /** Ids of indexed words one edit away. Empty for a short word. */
  typos: number[];
  stemKey: string;
  /** Vocabulary size and typo-bucket positions this was last resolved at. */
  at: number;
  seen: [number, number, number];
};

const terms = new Map<string, Term>();
const MAX_TERMS = 4000;

/**
 * Resolves a question word. Cheap to call again: it only looks at words added
 * to the vocabulary since the last call for the same word.
 */
export function termOf(text: string): Term {
  let term = terms.get(text);
  if (!term) {
    if (terms.size >= MAX_TERMS) terms.clear();
    term = { text, exact: NONE, stem: NONE, typos: [], stemKey: `~${stemOf(text)}`, at: -1, seen: [0, 0, 0] };
    terms.set(text, term);
  }
  if (term.at === words.length) return term;
  term.exact = ids.get(text) ?? NONE;
  term.stem = ids.get(term.stemKey) ?? NONE;
  if (text.length >= TYPO_MIN) {
    for (let delta = -1; delta <= 1; delta += 1) {
      const bucket = byLength[text.length + delta];
      if (!bucket) continue;
      for (let i = term.seen[delta + 1]; i < bucket.length; i += 1) {
        const id = bucket[i];
        // The word itself is `exact`. Listing it here too would change nothing.
        if (id !== term.exact && isEditDistanceOne(words[id], text)) term.typos.push(id);
      }
      term.seen[delta + 1] = bucket.length;
    }
  }
  term.at = words.length;
  return term;
}

/**
 * How strongly a bag holds a question word: its count, plus half the count of
 * words sharing its stem. When it holds neither, 0.6 of the count of the most
 * frequent word one typo away ("experince" finds "experience"), for words of
 * five letters or more only, so a correct spelling always wins.
 */
export function freq(bag: Bag, term: Term): number {
  if (bag.ids.length === 0) return 0;
  const exact = term.exact === NONE ? 0 : countOf(bag, term.exact);
  const stem = term.stem === NONE ? 0 : countOf(bag, term.stem);
  const direct = exact + 0.5 * stem;
  if (direct > 0) return direct;
  let best = 0;
  for (const id of term.typos) {
    const count = countOf(bag, id);
    if (count > best) best = count;
  }
  return 0.6 * best;
}

/** True when the bag has the word or a word with its stem. No typo tolerance. */
export function holds(bag: Bag, term: Term): boolean {
  if (bag.ids.length === 0) return false;
  return (term.exact !== NONE && countOf(bag, term.exact) > 0) || (term.stem !== NONE && countOf(bag, term.stem) > 0);
}

/** Id of an indexed word, or -1 when no indexed text has it. */
export function knownWordId(word: string): number {
  return ids.get(word) ?? NONE;
}

/** Ids of the indexed words (not stems) that pass `test`. One pass over the vocabulary. */
export function wordIdsWhere(test: (word: string) => boolean): number[] {
  const out: number[] = [];
  for (let id = 0; id < words.length; id += 1) {
    const word = words[id];
    if (word.charCodeAt(0) !== 126 && test(word)) out.push(id);
  }
  return out;
}

/** A test for "does this bag have any of these words", built once per question. */
export function anyOf(wanted: number[]): (bag: Bag) => boolean {
  if (wanted.length === 0) return () => false;
  if (wanted.length <= 12) {
    return (bag) => {
      for (const id of wanted) if (countOf(bag, id) > 0) return true;
      return false;
    };
  }
  const mask = new Uint8Array(words.length);
  for (const id of wanted) mask[id] = 1;
  return (bag) => {
    const list = bag.ids;
    for (let i = 0; i < list.length; i += 1) {
      const id = list[i];
      if (id < mask.length && mask[id] === 1) return true;
    }
    return false;
  };
}
