/**
 * Meeting memory: the last three answered questions, and what they cited.
 *
 * `thread.ts` resolves a pointer ("that", "after that") against the single
 * most recent answer. This keeps a little more, for two jobs that module does
 * not do:
 *
 *  - Context. The last three questions and the lines spoken for them go to
 *    the model as context, so it can tell what a follow-up refers to. They are
 *    never evidence: whatever the model says is still checked against the
 *    retrieved passages, and a line only the earlier answers support fails.
 *  - Thread expansion. A follow-up ("what about the error handling?") is
 *    looked up first in the files the thread already cited, instead of the
 *    whole index. When those files answer it, the search stops there. When
 *    they do not, the full search runs as before.
 *
 * The rule from `thread.ts` still holds: context resolves references, context
 * does not become the question. Nothing here rewrites the question. It only
 * changes where the question is looked up first.
 *
 * Only a Card that spoke is remembered. A question that got silence leaves
 * nothing behind to expand.
 */
import type { Card, IndexedChunk } from "../repo/types.ts";
import { FAST_PATH_MIN_SCORE } from "./answer-fast-path.ts";
import { contentWords } from "./spoken.ts";
import { withdrawReplay } from "./thread.ts";

/** How many answered questions are kept. */
export const MEMORY_TURNS = 3;

/** A follow-up reaches back this far. Past it, the question is a new topic. */
export const FOLLOW_UP_WINDOW_MS = 120_000;

/**
 * The best hit inside the thread's files has to be this strong for the search
 * to stop there. It is the score a hit needs before any answer is composed
 * from it without a model, so anything the thread search keeps is a hit the
 * full search would also have been allowed to answer from.
 */
export const THREAD_HIT_FLOOR = FAST_PATH_MIN_SCORE;

export type MemoryTurn = {
  question: string;
  /** The question after spoken cleanup, as retrieval saw it. */
  canonical: string;
  /** The line that was spoken. */
  answer: string;
  /** Files and documents the answer cited. */
  files: string[];
  /** Source ids of cited documents, when the citation names one. */
  sourceIds: string[];
  at: number;
};

/** The memory after this Card. Newest first, never more than `MEMORY_TURNS`. */
export function rememberTurn(
  turns: MemoryTurn[],
  input: { query: string; canonical: string; card: Card; at?: number },
): MemoryTurn[] {
  if (!input.card.say || !input.query.trim()) return turns;
  const files = new Set<string>();
  const sourceIds = new Set<string>();
  for (const cite of input.card.citations ?? []) {
    if (cite.kind === "file" || cite.kind === "document") {
      files.add(cite.path);
      if (cite.sourceId) sourceIds.add(cite.sourceId);
    }
  }
  const turn: MemoryTurn = {
    question: input.query.trim(),
    canonical: input.canonical.trim() || input.query.trim(),
    answer: input.card.say,
    files: [...files],
    sourceIds: [...sourceIds],
    at: input.at ?? Date.now(),
  };
  // The same question answered the same way is one turn, however many times
  // it was asked: a caption rewritten in place, or Enter pressed twice, must
  // not push a different question out of the three that are kept.
  const same = (earlier: MemoryTurn) =>
    earlier.answer === turn.answer && earlier.canonical.toLowerCase() === turn.canonical.toLowerCase();
  return [turn, ...turns.filter((earlier) => !same(earlier))].slice(0, MEMORY_TURNS);
}

/** "What about X", "and the X?", "how about X": a question that leans on the thread. */
const LEANS_ON_THREAD =
  /^(?:(?:(?:and|so|but|ok(?:ay)?)[,\s]+)?(?:what|how)\s+about\b|and\s+(?:the|its|their)\b)/i;

/** Does the wording itself lean on what was just discussed? */
export function leansOnThread(canonical: string): boolean {
  return LEANS_ON_THREAD.test(canonical.trim());
}

/**
 * Is this question a follow-up to the remembered thread?
 *
 * Yes when the question gate already resolved a pointer in it against the
 * thread, or when its wording leans on the thread and the last answer is
 * recent enough to lean on.
 */
export function isThreadFollowUp(
  canonical: string,
  turns: MemoryTurn[],
  opts: { resolved?: boolean; now?: number } = {},
): boolean {
  const latest = turns[0];
  if (!latest) return false;
  if ((opts.now ?? Date.now()) - latest.at > FOLLOW_UP_WINDOW_MS) return false;
  if (opts.resolved) return true;
  return leansOnThread(canonical) && contentWords(canonical).length > 0;
}

/**
 * The chunks of the files the thread cited. Order follows `chunks`, so the
 * result is the index restricted, not re-sorted.
 */
export function threadChunks(chunks: IndexedChunk[], turns: MemoryTurn[]): IndexedChunk[] {
  const paths = new Set<string>();
  const sourceIds = new Set<string>();
  for (const turn of turns) {
    for (const path of turn.files) paths.add(path);
    for (const id of turn.sourceIds) sourceIds.add(id);
  }
  if (paths.size === 0 && sourceIds.size === 0) return [];
  return chunks.filter((chunk) => {
    if (chunk.kind === "why") return false;
    if (!paths.has(chunk.path)) return false;
    // Two sources can hold the same path. When the thread named the source,
    // only that source's copy is the thread's file.
    return sourceIds.size === 0 || !chunk.sourceId || sourceIds.has(chunk.sourceId);
  });
}

/** The words of the question that are not the lean-on phrase itself. */
export function followUpQuery(canonical: string): string {
  return canonical
    .trim()
    .replace(/^(?:(?:and|so|but|ok(?:ay)?)[,\s]+)?(?:what|how)\s+about\s+/i, "")
    .replace(/^and\s+/i, "")
    .trim();
}

/**
 * A follow-up may not be answered with the line that was just spoken: the
 * room asked for something more and would hear the same sentence again. The
 * check itself lives in `thread.ts`; this points it at the last remembered
 * answer, which outlives the 45-second pointer window.
 */
export function withdrawRepeat(card: Card, turns: MemoryTurn[]): Card {
  const latest = turns[0];
  if (!latest) return card;
  return withdrawReplay(card, { claim: latest.answer }, true);
}

/** True when the Card's line is one a remembered turn already spoke. */
function repeatsATurn(card: Card, turns: MemoryTurn[]): boolean {
  return turns.some((turn) => !withdrawReplay(card, { claim: turn.answer }, true).say);
}

/**
 * Thread expansion: answer a follow-up from the files the thread already cited.
 *
 * A follow-up points at what was said last, so the newest turn's files are
 * tried first. Only when they hold nothing for it are the files of the turn
 * before tried, and then the one before that. After "how do exports retry?"
 * and then "when does the session expire?", "what about the error handling?"
 * is about sessions.
 *
 * Returns the hits and the answer when all of these hold for some turn, and
 * null otherwise (the caller then runs the full search):
 *
 *  - the question is a follow-up to a remembered answer,
 *  - that turn cited files that are still in the index,
 *  - the best hit inside those files clears `THREAD_HIT_FLOOR`,
 *  - `answer` speaks a line from those hits, and it is not a line a
 *    remembered turn already spoke.
 *
 * `retrieve` and `answer` are the caller's own: this decides when the thread
 * is enough, not how retrieval or composition work. `answer` is expected to
 * use the offline composer only, so a thread lookup that finds nothing costs
 * no model call before the full search starts.
 */
export async function expandThread<H extends { score: number }, R extends { card: Card }>(input: {
  canonical: string;
  turns: MemoryTurn[];
  chunks: IndexedChunk[];
  resolved?: boolean;
  now?: number;
  retrieve: (query: string, chunks: IndexedChunk[]) => Promise<H[]> | H[];
  answer: (hits: H[]) => Promise<R> | R;
}): Promise<{ hits: H[]; answered: R; query: string } | null> {
  if (!isThreadFollowUp(input.canonical, input.turns, { resolved: input.resolved, now: input.now })) return null;
  const query = followUpQuery(input.canonical);
  const tried = new Set<string>();
  for (const turn of input.turns.slice(0, MEMORY_TURNS)) {
    // Two turns that cited the same files are one place to look.
    const place = [...turn.files].sort().join("\n");
    if (tried.has(place)) continue;
    tried.add(place);
    const scoped = threadChunks(input.chunks, [turn]);
    if (scoped.length === 0) continue;
    const hits = await input.retrieve(query, scoped);
    if ((hits[0]?.score ?? 0) < THREAD_HIT_FLOOR) continue;
    const answered = await input.answer(hits);
    if (!answered.card.say) continue;
    if (repeatsATurn(answered.card, input.turns)) continue;
    return { hits, answered, query };
  }
  return null;
}

/** The remembered turns as model context, oldest first. Empty when there are none. */
export function memoryForPrompt(turns: MemoryTurn[]): Array<{ question: string; answer: string }> {
  return turns
    .slice(0, MEMORY_TURNS)
    .map((turn) => ({ question: turn.question, answer: turn.answer }))
    .reverse();
}
