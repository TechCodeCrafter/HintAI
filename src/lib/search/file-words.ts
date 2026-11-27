/**
 * Which files hold which words, so "how many files mention this term" is a
 * lookup rather than a read of every file.
 *
 * Admission needs that count for each word of a question (see `subject.ts`).
 * Counting by reading costs time in proportion to everything loaded: at 50 MB
 * it was the largest single cost of a question. This is built once per set of
 * files, in the background, before search is reported ready.
 *
 * The count is exact, not an estimate. A term made only of letters, digits and
 * underscores can only occur inside one unbroken run of those characters, so
 * a file holds the term exactly when one of its runs does. A term with any
 * other character is not answered here and the caller reads the files as
 * before.
 */

export type WordFile = { path: string; content: string };

type FileWords = {
  /** Every distinct run of word characters in the files. */
  words: string[];
  /** `files[starts[i]..starts[i + 1])` are the indexes of the files holding `words[i]`. */
  starts: Uint32Array;
  files: Uint32Array;
  fileCount: number;
};

const RUN = /[a-z0-9_]+/g;
const WORD_ONLY = /^[a-z0-9_]+$/;

/** Keyed by the array of files, which a pack keeps for as long as its files are the same. */
const BUILT = new WeakMap<readonly WordFile[], FileWords>();
const BUILDING = new WeakMap<readonly WordFile[], Promise<boolean>>();

/** The text a term is looked for in: the path and the content, lowered. */
export function haystackOf(file: WordFile): string {
  return `${file.path}\n${file.content}`.toLowerCase();
}

function addFile(postings: Map<string, number[]>, file: WordFile, index: number): void {
  const runs = haystackOf(file).match(RUN);
  if (!runs) return;
  for (const run of runs) {
    const list = postings.get(run);
    if (!list) postings.set(run, [index]);
    else if (list[list.length - 1] !== index) list.push(index);
  }
}

function pack(postings: Map<string, number[]>, fileCount: number): FileWords {
  let total = 0;
  for (const list of postings.values()) total += list.length;
  const words = new Array<string>(postings.size);
  const starts = new Uint32Array(postings.size + 1);
  const files = new Uint32Array(total);
  let at = 0;
  let i = 0;
  for (const [word, list] of postings) {
    words[i] = word;
    starts[i] = at;
    files.set(list, at);
    at += list.length;
    i += 1;
  }
  starts[i] = at;
  return { words, starts, files, fileCount };
}

/** Builds the index in one go. For tests and small sets; the app uses `warmFileWords`. */
export function buildFileWords(files: readonly WordFile[]): void {
  if (BUILT.has(files)) return;
  const postings = new Map<string, number[]>();
  for (let index = 0; index < files.length; index += 1) addFile(postings, files[index], index);
  BUILT.set(files, pack(postings, files.length));
}

export type WarmFileWordsOptions = {
  /** True once these files are no longer the ones in use. Ends the work. */
  isCancelled?: () => boolean;
  /** How long to work before letting the page breathe. */
  sliceMs?: number;
  pause?: () => Promise<void>;
};

/**
 * Builds the index in slices, so a large folder does not freeze the page.
 * Resolves true when the index is there, false when it was cancelled first.
 * A second call for the same files joins the first.
 */
export function warmFileWords(files: readonly WordFile[], options: WarmFileWordsOptions = {}): Promise<boolean> {
  if (BUILT.has(files)) return Promise.resolve(true);
  const running = BUILDING.get(files);
  if (running) return running;
  const sliceMs = options.sliceMs ?? 12;
  const pause = options.pause ?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
  const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
  const work = (async () => {
    const postings = new Map<string, number[]>();
    let sliceStart = now();
    for (let index = 0; index < files.length; index += 1) {
      addFile(postings, files[index], index);
      if (now() - sliceStart < sliceMs) continue;
      await pause();
      if (options.isCancelled?.()) return false;
      sliceStart = now();
    }
    BUILT.set(files, pack(postings, files.length));
    return true;
  })().finally(() => BUILDING.delete(files));
  BUILDING.set(files, work);
  return work;
}

export function fileWordsReady(files: readonly WordFile[]): boolean {
  return BUILT.has(files);
}

/**
 * How many of the files hold `needle` anywhere in their path or content.
 * Null when the index cannot say: it is not built for these files, or the
 * needle has a character that is not a letter, digit or underscore.
 */
export function filesHolding(files: readonly WordFile[], needle: string): number | null {
  const index = BUILT.get(files);
  if (!index || !WORD_ONLY.test(needle)) return null;
  const { words, starts, files: postings } = index;
  const seen = new Uint8Array(index.fileCount);
  let count = 0;
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i];
    if (word.length < needle.length || !word.includes(needle)) continue;
    for (let at = starts[i]; at < starts[i + 1]; at += 1) {
      const file = postings[at];
      if (seen[file] === 0) {
        seen[file] = 1;
        count += 1;
      }
    }
  }
  return count;
}
