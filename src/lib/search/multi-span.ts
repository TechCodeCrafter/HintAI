/**
 * One spoken answer from two or three written sentences.
 *
 * The composer normally speaks the single best sentence. That is right when the
 * sentence covers the question, and thin when the question has two halves and
 * the file answers them in two places ("how many retries, and what happens
 * after the last one?"). This joins the best sentence with up to two more, on
 * three conditions that keep it inside the evidence:
 *
 *  - Every sentence is spoken as it was written and keeps its own span, so
 *    each one has a citation behind it. Nothing is merged, shortened or bridged
 *    with a connective the files did not write.
 *  - A sentence is added only when it answers something the line so far does
 *    not: a whole part of the question that is still untouched ("... and what
 *    happens after the last one?"), or at least two question words nothing
 *    spoken yet covers. One stray matching word is not enough. A longer answer
 *    is not a better one.
 *  - A sentence that mostly restates the line so far is not added either, even
 *    when it happens to carry one new question word. Two files often describe
 *    the same thing in nearly the same words.
 *  - Each sentence passes the support check against its own span, and the
 *    joined line passes it against all of them.
 *
 * The only freedom taken is order: sentences from the same file are spoken in
 * the order the file wrote them, so "after the last attempt" does not come
 * before the sentence that says how many attempts there are.
 */
import { covers } from "./code-locator.ts";
import { type TextEvidence, verifyClaim } from "./evidence.ts";
import { quotesWholeSentences, unwrapEvidenceText } from "./claim-verify.ts";
import { sayable } from "./say.ts";
import { contentWords } from "./spoken.ts";

/** A sentence that could be spoken, with the span it was read from. */
export type SpanCandidate = {
  say: string;
  span: TextEvidence;
  /** How the composer ranked it against the question. Higher is better. */
  score: number;
};

export type CombinedSpans = {
  say: string;
  /** One span per spoken sentence, in spoken order. */
  evidence: TextEvidence[];
  /** Each spoken sentence beside the id of the span it was read from. */
  parts: Array<{ say: string; evidenceId: string }>;
};

/** The lead plus at most two more. */
export const MAX_COMBINED_SPANS = 3;
/** A spoken answer is short. Three sentences have to fit in this. */
export const MAX_COMBINED_CHARS = 380;
/** One added sentence. Longer than this is a paragraph, not a supporting line. */
const MAX_SUPPORT_CHARS = 200;
/** An added sentence may share at most this much of its wording with the line so far. */
const MAX_RESTATED = 0.5;

function firstSentence(text: string): string | null {
  const sentence = text
    .split(/(?<=[.!?])\s+/)
    .map((row) => row.trim())
    .find(Boolean);
  if (!sentence || sentence.length > MAX_SUPPORT_CHARS) return null;
  return sentence;
}

function closed(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function overlaps(a: TextEvidence, b: TextEvidence): boolean {
  if (a.path !== b.path || a.sourceId !== b.sourceId) return false;
  return a.startOffset < b.endOffset && b.startOffset < a.endOffset;
}

function sameWords(a: string, b: string): boolean {
  const flat = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const left = flat(a);
  const right = flat(b);
  return left === right || left.includes(right) || right.includes(left);
}

/** The share of a sentence's content words the line so far already uses. */
function restated(sentence: string, soFar: string): number {
  const words = [...new Set(sentence.toLowerCase().match(/[a-z0-9_]{4,}/g) ?? [])];
  if (words.length === 0) return 1;
  return words.filter((word) => covers(soFar, [word]) > 0).length / words.length;
}

/**
 * A sentence is supported by its own span. The negation and ordering checks
 * misread a sentence quoted whole (they compare one clause with the full
 * sentence), so those two, and only those, are waived for a whole quote. A
 * missing word is never waived.
 */
function supportedBy(say: string, spans: TextEvidence[]): boolean {
  const support = verifyClaim(say, spans);
  if (support.ok) return true;
  const failed = support.missing;
  if (failed.length === 0 || !failed.every((tag) => tag === "negation" || tag === "phrase_order")) return false;
  return quotesWholeSentences(say, spans.map((span) => unwrapEvidenceText(span.text)).join("\n"));
}

/** Where one part of a spoken question ends and the next begins. */
const PART_BREAK = /\s*(?:[,;]|\band\b|\bor\b|\bbut\b|\bplus\b|\balso\b|\bthen\b)\s*/i;
/** Question words a sentence must newly cover to be added on that alone. */
const MIN_NEW_TERMS = 2;

/**
 * The words that set each part of the question apart. A word several parts
 * share ("workers" in "alpha workers and bravo workers") says nothing about
 * which part a sentence answers, so each part keeps only its own words. A part
 * left with none is dropped.
 */
export function questionParts(question: string): string[][] {
  const parts = question.split(PART_BREAK).map((part) => contentWords(part));
  const seen = new Map<string, number>();
  for (const terms of parts) for (const term of new Set(terms)) seen.set(term, (seen.get(term) ?? 0) + 1);
  return parts
    .map((terms) => [...new Set(terms)].filter((term) => seen.get(term) === 1))
    .filter((terms) => terms.length > 0);
}

/**
 * Does the sentence answer something the line so far leaves open? Either it
 * reaches a part of the question nothing spoken has touched, covering at least
 * half of that part's words, or it covers two or more open question words.
 */
function addsToAnswer(sentence: string, soFar: string, parts: string[][], uncovered: string[]): boolean {
  const gained = uncovered.filter((term) => covers(sentence, [term]) > 0);
  if (gained.length === 0) return false;
  if (gained.length >= MIN_NEW_TERMS) return true;
  if (parts.length < 2) return false;
  return parts.some((terms) => {
    if (covers(soFar, terms) > 0) return false;
    return covers(sentence, terms) >= Math.ceil(terms.length / 2);
  });
}

/**
 * The lead sentence joined with the supporting sentences that add to it, or
 * null when one span already says everything the files have to say.
 *
 * `leadSay` is the line the composer was about to speak from `lead.span`.
 * `others` are the remaining admissible sentences, best first. `question` is
 * the question as asked, after spoken cleanup.
 */
export function combineSpans(
  leadSay: string,
  lead: SpanCandidate,
  others: SpanCandidate[],
  question: string,
): CombinedSpans | null {
  const parts = questionParts(question);
  const terms = [...new Set(contentWords(question))];
  if (terms.length < 2) return null;
  let uncovered = terms.filter((term) => covers(leadSay, [term]) === 0);
  if (uncovered.length === 0) return null;

  const picked: Array<{ say: string; span: TextEvidence; rank: number }> = [
    { say: closed(leadSay), span: lead.span, rank: 0 },
  ];
  let length = picked[0].say.length;

  for (const candidate of [...others].sort((a, b) => b.score - a.score)) {
    if (picked.length >= MAX_COMBINED_SPANS || uncovered.length === 0) break;
    if (candidate.score <= 0) continue;
    if (picked.some((item) => overlaps(item.span, candidate.span))) continue;
    const sentence = sayable(firstSentence(candidate.say));
    if (!sentence) continue;
    if (picked.some((item) => sameWords(item.say, sentence))) continue;
    const soFar = picked.map((item) => item.say).join(" ");
    if (!addsToAnswer(sentence, soFar, parts, uncovered)) continue;
    if (restated(sentence, soFar) > MAX_RESTATED) continue;
    const gained = uncovered.filter((term) => covers(sentence, [term]) > 0);
    const spoken = closed(sentence);
    if (length + 1 + spoken.length > MAX_COMBINED_CHARS) continue;
    if (!supportedBy(spoken, [candidate.span])) continue;
    picked.push({ say: spoken, span: candidate.span, rank: picked.length });
    length += 1 + spoken.length;
    uncovered = uncovered.filter((term) => !gained.includes(term));
  }
  if (picked.length < 2) return null;

  // Light reordering: files in the order they were picked (the lead's file
  // first), and inside one file the order the file itself wrote them in.
  const fileRank = new Map<string, number>();
  for (const item of picked) {
    const key = `${item.span.sourceId}\u0000${item.span.path}`;
    if (!fileRank.has(key)) fileRank.set(key, item.rank);
  }
  const ordered = [...picked].sort((a, b) => {
    const fileA = fileRank.get(`${a.span.sourceId}\u0000${a.span.path}`) ?? 0;
    const fileB = fileRank.get(`${b.span.sourceId}\u0000${b.span.path}`) ?? 0;
    return fileA - fileB || a.span.startOffset - b.span.startOffset;
  });

  const say = ordered.map((item) => item.say).join(" ");
  const evidence = ordered.map((item) => item.span);
  if (!supportedBy(say, evidence)) return null;
  return {
    say,
    evidence,
    parts: ordered.map((item) => ({ say: item.say, evidenceId: item.span.id })),
  };
}
