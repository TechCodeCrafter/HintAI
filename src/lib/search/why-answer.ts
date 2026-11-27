/**
 * "Why this answer?": the exact evidence behind a spoken Card, ready to show.
 *
 * Every Card that speaks carries the spans it was read from. This turns them
 * into rows a screen can list: where the span is, the text exactly as the
 * source holds it, and which of its words the spoken line uses. It reads only
 * the Card, so it works with no network and on a Card restored from history
 * or mirrored to the second screen.
 *
 * Nothing here decides whether a Card may speak. That was decided before the
 * Card existed; this only shows the work.
 */
import type { Card } from "../repo/types.ts";
import type { Evidence } from "./evidence.ts";

/**
 * A run of evidence text. `hit` marks text the spoken line uses. `exact` marks
 * a run the spoken line repeats word for word, three words or more in a row;
 * a hit without it is a single word the line uses somewhere.
 */
export type WhySegment = { text: string; hit: boolean; exact?: true };

export type WhySpan = {
  id: string;
  kind: Evidence["kind"];
  /** Where the span is: `path:line`, `path p. 3`, or `commit abc1234`. */
  label: string;
  /** Extra provenance worth a second line: a heading, or a commit's author and date. */
  detail: string | null;
  /** The span exactly as the source holds it. */
  text: string;
  segments: WhySegment[];
  /** The spoken sentence read from this span, when the Card records one per span. */
  said: string | null;
};

/** Words too common to show anything by being highlighted. */
const PLAIN = new Set([
  "the", "and", "for", "with", "that", "this", "from", "are", "was", "were", "has", "have", "had",
  "its", "into", "than", "then", "you", "your", "our", "can", "will", "but", "not", "any", "all",
  "when", "what", "which", "who", "how", "why", "does", "did", "been", "being", "they", "them",
  "their", "there", "here", "also", "only", "each", "per", "via", "out", "off", "over", "onto",
]);

/** Short words still worth marking: anything with a digit in it ("3", "v2"). */
function carries(word: string): boolean {
  return (word.length >= 3 || /\d/.test(word)) && !PLAIN.has(word);
}

function wordsOf(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
}

/** How many words in a row the passage and the spoken line must share to count as an exact span. */
export const EXACT_SPAN_WORDS = 3;

/**
 * Splits evidence text into runs and marks what the spoken line took from it.
 *
 * Two kinds of mark. An exact span is `EXACT_SPAN_WORDS` or more words in a
 * row that the spoken line repeats in the same order: the sentence that was
 * read out, wherever it sits in the passage. It is marked whole, filler words
 * included, and it stops at a line break so comment markers and indentation
 * stay outside it. Every other word the line uses is marked on its own;
 * marked words separated only by spaces are one run.
 *
 * Case and punctuation between words are ignored when matching. The runs
 * joined back together are the input, character for character.
 */
export function highlight(text: string, spoken: string): WhySegment[] {
  if (!text) return [];
  const said = wordsOf(spoken);
  const wanted = new Set(said.filter(carries));
  if (wanted.size === 0) return [{ text, hit: false }];

  const tokens: Array<{ word: string; start: number; end: number }> = [];
  const pattern = /[A-Za-z0-9_]+/g;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    tokens.push({ word: match[0].toLowerCase(), start: match.index, end: match.index + match[0].length });
  }
  const places = new Map<string, number[]>();
  said.forEach((word, index) => {
    const list = places.get(word);
    if (list) list.push(index);
    else places.set(word, [index]);
  });

  // 0: not marked. 1: a word the line uses. Above 1: the id of an exact span.
  const kind = new Array<number>(tokens.length).fill(0);
  let spanId = 1;
  for (let i = 0; i < tokens.length; ) {
    let longest = 0;
    for (const at of places.get(tokens[i]!.word) ?? []) {
      let length = 1;
      while (i + length < tokens.length && at + length < said.length && tokens[i + length]!.word === said[at + length]) {
        length += 1;
      }
      if (length > longest) longest = length;
    }
    const run = tokens.slice(i, i + longest);
    if (longest >= EXACT_SPAN_WORDS && run.some((token) => carries(token.word))) {
      spanId += 1;
      for (let k = 0; k < longest; k += 1) kind[i + k] = spanId;
      i += longest;
    } else {
      if (wanted.has(tokens[i]!.word)) kind[i] = 1;
      i += 1;
    }
  }

  const out: WhySegment[] = [];
  const push = (chunk: string, mark: number) => {
    if (!chunk) return;
    const hit = mark > 0;
    const exact = mark > 1;
    const last = out[out.length - 1];
    if (last && last.hit === hit && Boolean(last.exact) === exact) last.text += chunk;
    else out.push(exact ? { text: chunk, hit, exact: true } : { text: chunk, hit });
  };
  let cursor = 0;
  tokens.forEach((token, index) => {
    const gap = text.slice(cursor, token.start);
    const before = index > 0 ? kind[index - 1]! : 0;
    const now = kind[index]!;
    // Inside one exact span the gap is part of it, up to a line break. Between
    // two marked words, only plain spacing joins them.
    const joined =
      now > 1 && before === now ? !gap.includes("\n") : now === 1 && before === 1 && /^[ \t]+$/.test(gap);
    push(gap, joined ? now : 0);
    push(text.slice(token.start, token.end), now);
    cursor = token.end;
  });
  push(text.slice(cursor), 0);
  return out;
}

function describe(item: Evidence): Pick<WhySpan, "label" | "detail" | "text"> {
  if (item.kind === "text") {
    const lines = item.endLine > item.startLine ? `${item.startLine}-${item.endLine}` : `${item.startLine}`;
    return { label: `${item.path}:${lines}`, detail: item.heading ?? null, text: item.text };
  }
  if (item.kind === "document") {
    return { label: `${item.path} p. ${item.page}`, detail: item.heading ?? null, text: item.sourceText };
  }
  const by = [item.author, item.date, item.pr].filter(Boolean).join(" · ");
  return { label: `commit ${item.shortSha}`, detail: by || null, text: item.message };
}

/**
 * The evidence rows for a Card, in the order the Card holds them. Empty for a
 * Card that says nothing: there is no answer to explain, and the reason it is
 * silent is shown where the answer would be.
 */
export function whyAnswer(card: Pick<Card, "say" | "evidence" | "parts"> | null | undefined): WhySpan[] {
  if (!card?.say) return [];
  const partOf = new Map((card.parts ?? []).map((part) => [part.evidenceId, part.say]));
  return (card.evidence ?? []).map((item) => {
    const said = partOf.get(item.id) ?? null;
    const shown = describe(item);
    return {
      id: item.id,
      kind: item.kind,
      ...shown,
      segments: highlight(shown.text, said ?? card.say ?? ""),
      said,
    };
  });
}

/**
 * A name for the answer a Card holds, the same before and after a reload and
 * on the second screen: the question, the spoken line and the evidence it
 * cites. Used to remember that its evidence view was left open. Null for a
 * Card that says nothing.
 */
export function evidenceKey(card: Pick<Card, "say" | "evidence" | "query"> | null | undefined): string | null {
  if (!card?.say) return null;
  const ids = (card.evidence ?? []).map((item) => item.id).join("\n");
  const text = `${card.query ?? ""}\n${card.say}\n${ids}`;
  // FNV-1a. Not a security boundary: a clash would only leave a view open.
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193);
  }
  return `${(hash >>> 0).toString(36)}-${text.length.toString(36)}`;
}
