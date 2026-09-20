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
  first: "1",
  second: "2",
  third: "3",
  fourth: "4",
  fifth: "5",
  sixth: "6",
  seventh: "7",
  eighth: "8",
  ninth: "9",
  tenth: "10",
};

const VERSION_PATTERN = /\bv?\d+(?:\.\d+){1,3}\b/gi;
const UNIT_PATTERN =
  /\b\d+(?:\.\d+)?\s*(?:ms|milliseconds?|seconds?|secs?|minutes?|mins?|hours?|hrs?|days?|weeks?|months?|years?|kb|mb|gb|tb|percent|%|rps|qps)\b/gi;

const CLAUSE_SPLIT =
  /\s*;\s*|\s*,\s+(?=and\b|but\b|so\b|then\b|while\b|because\b)|\s+(?:and|but|so|then|while|because)\s+/i;

function escapeRegex(token: string): string {
  return token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

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

/** Whole-word token match — avoids "attempt" matching inside "attempts". */
export function blockIncludesToken(block: string, token: string): boolean {
  if (!token) return false;
  return new RegExp(`\\b${escapeRegex(token)}\\b`).test(block);
}

/** Strip comment/list prefixes and reflow hard line breaks inside paragraphs. */
export function unwrapEvidenceText(text: string): string {
  const lines = text
    .replace(/\/\*\*?|\*\//g, " ")
    .split(/\n/)
    .map((line) =>
      line
        .replace(/^\s*[\*\/]+\s?/, "")
        .replace(/^\s*(\/\/|#)\s?/, "")
        .replace(/^\s*-\s+/, "")
        .trim(),
    )
    .filter(Boolean);

  const paragraphs: string[] = [];
  let buf = "";
  for (const line of lines) {
    if (!buf) {
      buf = line;
      continue;
    }
    if (/[.!?]["']?$/.test(buf)) {
      paragraphs.push(buf);
      buf = line;
    } else {
      buf = `${buf} ${line}`;
    }
  }
  if (buf) paragraphs.push(buf);
  return paragraphs.join("\n");
}

/** Sentence-scoped evidence blocks after unwrap/reflow. */
export function splitEvidenceBlocks(text: string): string[] {
  const unwrapped = unwrapEvidenceText(text);
  return unwrapped
    .split(/(?<=[.!?])\s+|\n+/)
    .map((block) => block.toLowerCase())
    .filter((block) => block.length > 0);
}

/** Split a spoken claim into clauses that may map to separate evidence sentences. */
export function splitClaimClauses(claim: string): string[] {
  const trimmed = claim.trim();
  if (!trimmed) return [];
  let parts = [trimmed];
  for (const splitter of [
    /\s*;\s*/,
    /(?<=[.!?])\s+/,
    /\s*,\s+(?=and\b|but\b|so\b|then\b|while\b|because\b)/i,
    /\s+and\s+(?=[a-z][a-z-]*\s+(?:are|is|was|were|has|have|require|run|process|support)\b)/i,
    /\s*,\s+/,
  ]) {
    parts = parts.flatMap((part) =>
      part
        .split(splitter)
        .map((piece) => piece.trim())
        .filter(Boolean),
    );
  }
  return parts.length > 0 ? parts : [trimmed];
}

function tokensInClause(clause: string, orderingTokens: string[]): string[] {
  const lower = clause.toLowerCase();
  return orderingTokens.filter((token) => blockIncludesToken(lower, token));
}

function anchorBlock(blocks: string[], tokens: string[]): string {
  let best = blocks[0] ?? "";
  let score = 0;
  for (const block of blocks) {
    const hit = tokens.filter((token) => blockIncludesToken(block, token)).length;
    if (hit > score) {
      score = hit;
      best = block;
    }
  }
  return best;
}

function anchorLooksProse(anchored: string): boolean {
  return anchored.length >= 16 && /[a-z]{3,}\s+[a-z]{3,}/.test(anchored);
}

/** Partial claims that drop a material number from the anchored sentence fail closed. */
function omitsAnchoredNumbers(claim: string, anchored: string): boolean {
  const anchorNums = extractNumbers(anchored);
  const claimNums = extractNumbers(claim);
  if (anchorNums.length === 0 || claimNums.length > 0) return false;
  if (!anchorLooksProse(anchored)) return false;
  const claimWords = claim
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9_]+/, "").replace(/[^a-z0-9_]+$/, ""))
    .filter((w) => w.length >= 4);
  if (claimWords.length < 3) return false;
  return sharesActionStem(claim, anchored);
}

/** Numeric and unit tokens in the claim must appear in evidence. */
export function numericsCompatible(claim: string, anchored: string, fullCorpus: string): boolean {
  const claimNums = extractNumbers(claim);
  const corpusNums = extractNumbers(fullCorpus);
  const anchoredNums = extractNumbers(anchored);
  const numericPool = anchoredNums.length > 0 ? anchoredNums : corpusNums;
  for (const num of claimNums) {
    if (!numericPool.includes(num)) return false;
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

/** Content tokens must appear in corpus in the same relative order (whole words). */
export function orderedContentSubsequence(contentTokens: string[], corpus: string): boolean {
  if (contentTokens.length === 0) return true;
  if (contentTokens.length === 1) return blockIncludesToken(corpus, contentTokens[0]!);
  let pos = 0;
  for (const token of contentTokens) {
    const pattern = new RegExp(`\\b${escapeRegex(token)}\\b`, "g");
    pattern.lastIndex = pos;
    const match = pattern.exec(corpus);
    if (!match) return false;
    pos = match.index + match[0].length;
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
  const parts = splitEvidenceBlocks(corpus);
  if (parts.length === 0) return corpus.toLowerCase();
  return anchorBlock(parts, contentTokens);
}

function clauseHosted(clauseTokens: string[], blocks: string[]): boolean {
  if (clauseTokens.length === 0) return true;
  if (clauseTokens.length === 1) {
    return blocks.some((block) => blockIncludesToken(block, clauseTokens[0]!));
  }
  return blocks.some(
    (block) =>
      clauseTokens.every((token) => blockIncludesToken(block, token)) &&
      orderedContentSubsequence(clauseTokens, block),
  );
}

function clausesOrderCompatible(
  say: string,
  orderingTokens: string[],
  blocks: string[],
): boolean {
  if (orderingTokens.length <= 1) return true;
  const clauses = splitClaimClauses(say);
  if (clauses.length === 0) return true;

  const assigned = new Set<string>();
  for (const clause of clauses) {
    const clauseTokens = tokensInClause(clause, orderingTokens).filter((token) => !assigned.has(token));
    if (!clauseHosted(clauseTokens, blocks)) return false;
    for (const token of clauseTokens) assigned.add(token);
  }

  const leftover = orderingTokens.filter((token) => !assigned.has(token));
  if (leftover.length === 0) return true;
  return clauseHosted(leftover, blocks);
}

/**
 * Stricter semantic checks after the bag-of-words gate passes.
 * Returns ok=false when meaning may have been inverted or invented.
 */
export function verifyClaimSemantics(
  say: string,
  corpus: string,
  contentTokens: string[],
  blocks: string[] = splitEvidenceBlocks(corpus),
  orderingExempt: string[] = [],
  numericCorpus: string = corpus,
): SemanticVerifyResult {
  const exempt = new Set(orderingExempt.map((token) => token.toLowerCase()));
  const orderingTokens = contentTokens.filter((token) => !exempt.has(token));
  const reasons: string[] = [];

  const clauses = splitClaimClauses(say);
  for (const clause of clauses) {
    const clauseTokens = tokensInClause(clause, orderingTokens);
    const anchored = anchorBlock(blocks, clauseTokens);
    if (!negationCompatible(clause, anchored)) reasons.push("negation");
    if (!numericsCompatible(clause, anchored, numericCorpus)) reasons.push("numeric");
  }

  if (
    clauses.length === 1 &&
    omitsAnchoredNumbers(say, anchorBlock(blocks, orderingTokens))
  ) {
    reasons.push("numeric");
  }

  if (extractiveMatch(say, corpus)) {
    return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
  }

  if (!clausesOrderCompatible(say, orderingTokens, blocks)) reasons.push("phrase_order");
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)] };
}
