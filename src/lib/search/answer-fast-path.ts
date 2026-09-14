import type { Card, Hit } from "../repo/types.ts";
import { contentWords } from "./spoken.ts";

/** Minimum top retrieval score for a verified localCard to bypass LLM (matches local-card NO_EVIDENCE gate). */
export const FAST_PATH_MIN_SCORE = 4;

/** Below this max hit score, skip LLM and return silent when overlap is also weak. */
export const FAIL_FAST_MAX_SCORE = 2;

const OFF_TOPIC = /\b(weather|stock price|world series|capital of france|bake sourdough)\b/i;

/**
 * Deterministic silent path — no LLM when retrieval cannot plausibly support an answer.
 * Uses existing retrieval scores and query/hit overlap, not a hallucination-prone confidence model.
 */
export function shouldFailFastRetrieval(query: string, hits: Hit[]): boolean {
  if (hits.length === 0) return true;
  if (OFF_TOPIC.test(query)) return true;

  const scores = hits.map((hit) => hit.score ?? 0);
  const maxScore = Math.max(...scores);
  if (maxScore >= FAST_PATH_MIN_SCORE) return false;
  if (maxScore > FAIL_FAST_MAX_SCORE) return false;

  const terms = contentWords(query);
  if (terms.length === 0) return maxScore <= FAIL_FAST_MAX_SCORE;

  const corpus = hits
    .map((hit) => hit.text ?? "")
    .join(" ")
    .toLowerCase();
  const overlap = terms.filter((term) => corpus.includes(term)).length;
  return overlap === 0;
}

function citedSourceIds(card: Card): Set<string> {
  const ids = new Set<string>();
  for (const cite of card.citations ?? []) {
    if ("sourceId" in cite && cite.sourceId) ids.add(cite.sourceId);
  }
  return ids;
}

function hitSourceIds(hits: Hit[]): Set<string> {
  const ids = new Set<string>();
  for (const hit of hits) {
    if (hit.sourceId) ids.add(hit.sourceId);
  }
  return ids;
}

/** Cross-source questions need citations spanning sources — partial localCard must use LLM/synthesis. */
export function needsMultiSourceCoverage(hits: Hit[], card: Card): boolean {
  const sources = hitSourceIds(hits);
  if (sources.size < 2) return false;
  const cited = citedSourceIds(card);
  return cited.size < 2;
}

/**
 * A verified localCard may bypass grounded/synthesis LLM when it already satisfies
 * the evidence contract. This is not progressive rendering — one final answer only.
 */
export function localCardFastPathEligible(card: Card, hits: Hit[]): boolean {
  if (!card.say?.trim()) return false;
  if (!card.evidence?.length) return false;
  if (!card.citations?.length) return false;

  const evidenceIds = new Set(card.evidence.map((row) => row.id));
  const citedEvidence = card.citations
    .map((cite) => cite.evidenceId)
    .filter((id): id is string => Boolean(id));
  if (citedEvidence.length === 0) return false;
  if (!citedEvidence.every((id) => evidenceIds.has(id))) return false;

  const top = hits[0];
  const topScore = top?.score ?? 0;
  if (topScore < FAST_PATH_MIN_SCORE) return false;

  if (needsMultiSourceCoverage(hits, card)) return false;

  return true;
}

/** Rough token estimate for prompt profiling (chars / 4). */
export function estimatePromptTokens(prompt: string): number {
  return Math.ceil(prompt.length / 4);
}
