/**
 * Why the composer did not speak.
 *
 * Silence is a first-class outcome in GROUND, which makes an undifferentiated
 * `null` the wrong answer to "why?". A question the repo cannot answer and a
 * question the repo answers in a sentence we failed to read are the same silence
 * on screen and completely different defects. Every rejection therefore carries
 * a code, so false silence can be separated from legitimate silence by counting
 * rather than by guessing.
 *
 * Diagnostic only: nothing here influences composition.
 */

export type RejectCode =
  /** The file says nothing about itself — no docstring, comment or markdown. */
  | "NO_PROSE"
  /** Prose exists but yielded no sentence and no capability list. */
  | "NO_SPEAKABLE_SENTENCE"
  /** Fewer than four words: a fragment, not a claim. */
  | "TOO_SHORT"
  /** Over the spoken budget, and cutting it would break the sentence. */
  | "TOO_LONG"
  /** Reads as code or signature, not as something a person says. */
  | "STRUCTURAL_ONLY"
  /** The claim mentions nothing the question asked about. */
  | "LOW_OVERLAP"
  /** Eligible, but another candidate scored higher. */
  | "NOT_PREFERRED"
  /** On topic, but not strongly enough to be admitted at all. */
  | "SCORE_FLOOR"
  /** The same sentence already offered by an earlier candidate. */
  | "DUPLICATE"
  /** Retrieval itself returned nothing worth citing. */
  | "NO_EVIDENCE"
  /** Speakable and on topic, but the wrong kind of answer for the question. */
  | "WRONG_SHAPE"
  /**
   * Scored only on generic or path overlap: the evidence sits somewhere
   * relevant and never mentions what was actually asked about.
   */
  | "NO_SUBJECT_COVERAGE"
  | "OTHER";

export type ClaimAttempt = {
  query: string;
  path: string;
  line: number;
  origin: "span" | "head" | "why";
  /** The sentence considered, when one was produced at all. */
  candidate: string;
  generic: boolean;
  relevance: number;
  score: number;
  accepted: boolean;
  reject: RejectCode | null;
  /** Where the score came from, term by term. See subject.ts `explain`. */
  provenance?: string;
};

export type ClaimDecision = {
  query: string;
  attempts: ClaimAttempt[];
  spoke: boolean;
  /** For a silent result, the single reason that best explains it. */
  reason: RejectCode | null;
};

let current: ClaimAttempt[] = [];
let decisions: ClaimDecision[] = [];
let on = false;

export function traceClaims(enabled: boolean) {
  on = enabled;
  current = [];
  decisions = [];
}

export function noteAttempt(attempt: ClaimAttempt) {
  if (on) current.push(attempt);
}

/** Closes the decision for one question and returns it. */
export function closeDecision(query: string, spoke: boolean): ClaimDecision | null {
  if (!on) return null;
  const attempts = current;
  current = [];
  // The dominant reason: what stopped the best candidate we actually had. A
  // rejection on a claim that was speakable is more informative than one on a
  // file that never produced a sentence, so eligible-but-rejected wins.
  const ranked: RejectCode[] = [
    "TOO_LONG",
    "NO_SUBJECT_COVERAGE",
    "SCORE_FLOOR",
    "LOW_OVERLAP",
    "NOT_PREFERRED",
    "NO_SPEAKABLE_SENTENCE",
    "TOO_SHORT",
    "STRUCTURAL_ONLY",
    "DUPLICATE",
    "NO_PROSE",
    "NO_EVIDENCE",
  ];
  const seen = new Set(attempts.map((a) => a.reject).filter(Boolean) as RejectCode[]);
  const reason = spoke ? null : (ranked.find((code) => seen.has(code)) ?? "OTHER");
  const decision: ClaimDecision = { query, attempts, spoke, reason };
  decisions.push(decision);
  return decision;
}

export function claimDecisions(): ClaimDecision[] {
  return decisions;
}

/**
 * Records a rejection applied after composition finished, so a Card withdrawn
 * by the shape gate is not filed under a vague `OTHER`. The composer's own
 * decision is already closed by then; this amends it.
 */
export function overrideDecision(query: string, reason: RejectCode) {
  if (!on) return;
  const last = decisions.at(-1);
  if (last && last.query === query) {
    last.spoke = false;
    last.reason = reason;
    return;
  }
  decisions.push({ query, attempts: [], spoke: false, reason });
}
