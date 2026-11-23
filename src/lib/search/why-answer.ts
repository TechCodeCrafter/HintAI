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

/** A run of evidence text. `hit` marks words the spoken line uses. */
export type WhySegment = { text: string; hit: boolean };

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

function spokenWords(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z0-9_]+/g) ?? [];
  return new Set(words.filter((word) => word.length >= 3 && !PLAIN.has(word)));
}

/**
 * Splits evidence text into runs, marking each word the spoken line uses.
 * Marked words separated only by spaces are one run, so a quoted sentence
 * reads as a highlighted sentence and not as a row of separate words. The runs
 * joined back together are the input, character for character.
 */
export function highlight(text: string, spoken: string): WhySegment[] {
  const wanted = spokenWords(spoken);
  if (wanted.size === 0 || !text) return text ? [{ text, hit: false }] : [];
  const out: WhySegment[] = [];
  const push = (chunk: string, hit: boolean) => {
    if (!chunk) return;
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += chunk;
    else out.push({ text: chunk, hit });
  };
  const word = /[A-Za-z0-9_]+/g;
  let cursor = 0;
  for (let match = word.exec(text); match; match = word.exec(text)) {
    const gap = text.slice(cursor, match.index);
    const hit = wanted.has(match[0].toLowerCase());
    const last = out[out.length - 1];
    // A space between two marked words stays inside the mark.
    push(gap, Boolean(hit && last?.hit && /^[ \t]+$/.test(gap)));
    push(match[0], hit);
    cursor = match.index + match[0].length;
  }
  push(text.slice(cursor), false);
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
