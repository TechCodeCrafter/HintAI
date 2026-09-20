/**
 * Deterministic claim verification beyond bag-of-words overlap.
 * Fail closed: unsupported beats a confident wrong answer.
 */

const WORD_NUMBERS: Record<string, string> = {
  zero: "0",
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
};

const VERSION_PATTERN = /\bv?\d+(?:\.\d+){1,3}\b/gi;
const UNIT_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|kb|mb|gb|tb|percent|%|rps|qps)\b/gi;

function normalizeSurface(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractNumbers(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const match of lower.matchAll(/\b\d+(?:\.\d+)?\b/g)) {
    found.push(match[0]!);
  }
  for (const [word, digit] of Object.entries(WORD_NUMBERS)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(lower)) found.push(digit);
  }
  return [...new Set(found)];
}

function extractUnits(text: string): string[] {
  return [...text.toLowerCase().matchAll(UNIT_PATTERN)].map((m) => m[0]!.replace(/\s+/g, " "));
}

function extractVersions(text: string): string[] {
  return [...text.toLowerCase().matchAll(VERSION_PATTERN)].map((m) => m[0]!);
}

function negationProfile(text: string): { never: boolean; not: boolean; without: boolean; negated: boolean } {
  const lower = text.toLowerCase();
  const never = /\bnever\b/.test(lower);
  const not = /\bnot\b/.test(lower);
  const without = /\bwithout\b/.test(lower);
  const negated =
    never ||
    not ||
    without ||
    /\b(cannot|can't|won't|doesn't|don't|isn't|aren't|wasn't|weren't|nor|none|nothing)\b/.test(lower);
  return { never, not, without, negated };
}

/** Negation in the claim must match negation in evidence — "never" cannot affirm "retries". */
export function negationCompatible(claim: string, corpus: string): boolean {
  const claimNeg = negationProfile(claim);
  const corpusNeg = negationProfile(corpus);
  if (claimNeg.never && !corpusNeg.never) return false;
  if (claimNeg.without && !corpusNeg.without && !corpusNeg.not && !corpusNeg.never) return false;
  if (claimNeg.not && !corpusNeg.not && !corpusNeg.never && corpusNeg.negated === false) {
    // Claim denies; evidence is affirmative about the same action.
    if (sharesActionStem(claim, corpus)) return false;
  }
  if (!claimNeg.negated && corpusNeg.negated && sharesActionStem(claim, corpus)) {
    return false;
  }
  return true;
}

function sharesActionStem(claim: string, corpus: string): boolean {
  const stems = [...claim.toLowerCase().matchAll(/\b[a-z]{5,}(?:ing|ed|es|s)?\b/g)]
    .map((m) => m[0]!)
    .filter((w) => !GLUE_ACTION.has(w));
  return stems.some((stem) => corpus.includes(stem.slice(0, Math.min(stem.length, 6))));
}

const GLUE_ACTION = new Set([
  "about",
  "after",
  "again",
  "before",
  "being",
  "could",
  "every",
  "never",
  "other",
  "should",
  "their",
  "there",
  "these",
  "those",
  "through",
  "under",
  "until",
  "which",
  "while",
  "would",
]);

/** Numeric and unit tokens in the claim must appear in evidence. */
export function numericsCompatible(claim: string, anchored: string, fullCorpus: string): boolean {
  const claimNums = extractNumbers(claim);
  const corpusNums = extractNumbers(fullCorpus);
  const anchoredNums = extractNumbers(anchored);
  for (const num of claimNums) {
    if (!corpusNums.includes(num)) return false;
  }
  if (anchoredNums.length > 0 && claimNums.length === 0 && sharesActionStem(claim, anchored)) {
    return false;
  }
  const claimUnits = extractUnits(claim);
  const corpusUnits = extractUnits(fullCorpus);
  for (const unit of claimUnits) {
    if (!corpusUnits.some((u) => u === unit || fullCorpus.includes(unit))) return false;
  }
  const claimVersions = extractVersions(claim);
  const corpusVersions = extractVersions(fullCorpus);
  for (const version of claimVersions) {
    if (!corpusVersions.includes(version)) return false;
  }
  return true;
}

/** Content tokens must appear in corpus in the same relative order. */
export function orderedContentSubsequence(contentTokens: string[], corpus: string): boolean {
  if (contentTokens.length === 0) return true;
  if (contentTokens.length === 1) return corpus.includes(contentTokens[0]!);
  let pos = 0;
  for (const token of contentTokens) {
    const idx = corpus.indexOf(token, pos);
    if (idx === -1) return false;
    pos = idx + token.length;
  }
  return true;
}

/** Near-extractive: normalized claim is a substring of normalized evidence. */
export function extractiveMatch(claim: string, corpus: string): boolean {
  const normClaim = normalizeSurface(claim);
  const normCorpus = normalizeSurface(corpus);
  if (!normClaim || normClaim.length < 12) return false;
  return normCorpus.includes(normClaim);
}

export type SemanticVerifyResult = {
  ok: boolean;
  /** Machine-readable failure tags for tests and telemetry. */
  reasons: string[];
};

/** Pick the evidence sentence that best overlaps the claim tokens. */
export function anchorSentence(corpus: string, contentTokens: string[]): string {
  const parts = corpus.split(/\n|[.!?]+/);
  let best = corpus;
  let score = 0;
  for (const part of parts) {
    const lower = part.toLowerCase();
    const hit = contentTokens.filter((token) => lower.includes(token)).length;
    if (hit > score) {
      score = hit;
      best = lower;
    }
  }
  return best.trim() || corpus;
}

function blocksOrderCompatible(contentTokens: string[], blocks: string[]): boolean {
  if (contentTokens.length <= 1) return true;
  const groups = blocks
    .map((block) => contentTokens.filter((token) => block.includes(token)))
    .filter((group) => group.length >= 2);
  if (groups.length === 0) return true;
  return groups.every((group) => {
    const block = blocks.find((candidate) => group.every((token) => candidate.includes(token)));
    return block ? orderedContentSubsequence(group, block) : false;
  });
}

/**
 * Stricter semantic checks after the bag-of-words gate passes.
 * Returns ok=false when meaning may have been inverted or invented.
 */
export function verifyClaimSemantics(
  say: string,
  corpus: string,
  contentTokens: string[],
  blocks: string[] = [corpus],
): SemanticVerifyResult {
  const anchored = anchorSentence(corpus, contentTokens);
  const reasons: string[] = [];
  if (!negationCompatible(say, anchored)) reasons.push("negation");
  if (!numericsCompatible(say, anchored, corpus)) reasons.push("numeric");
  if (extractiveMatch(say, anchored) || extractiveMatch(say, corpus)) {
    return { ok: reasons.length === 0, reasons };
  }
  if (!blocksOrderCompatible(contentTokens, blocks)) reasons.push("phrase_order");
  return { ok: reasons.length === 0, reasons };
}
