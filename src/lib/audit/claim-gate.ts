import { cleanCaption, isChatter, looksLikeQuestion } from "../search/question.ts";

/**
 * Inverse of the question gate. A line already said, not something to compose.
 * Logistics and chatter are dropped. Claim-like statements are kept.
 */

const QUANTITY =
  /\b(\d+(?:[.,]\d+)?\s*(?:k|m|ms|s|%|rps|rpm|qps)?|q[1-4]|20\d{2})\b/i;

const DATE =
  /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;

const DECIDED = /\bwe (?:decided|chose|agreed|set|shipped|committed)\b/i;

const CONTRACT = /\bthe (?:contract|spec|sla|agreement) says\b/i;

const SLA = /\bslas?\b/i;

const PERFORMANCE = /\b(rps|qps|rpm|throughput|latency|p99|p95|capped|retries|attempts)\b/i;

/** Shape only: is this a claim-like statement? */
export function looksLikeClaim(text: string): boolean {
  const t = cleanCaption(text);
  if (t.length < 8) return false;
  if (QUANTITY.test(t)) return true;
  if (DATE.test(t)) return true;
  if (DECIDED.test(t)) return true;
  if (CONTRACT.test(t)) return true;
  if (SLA.test(t)) return true;
  if (PERFORMANCE.test(t)) return true;
  return false;
}

/**
 * Whether a spoken line should enter the claim ledger.
 * Questions stay on the Listen → Search path.
 */
export function isClaimLine(text: string): boolean {
  const t = cleanCaption(text);
  if (!t) return false;
  if (isChatter(t)) return false;
  if (looksLikeQuestion(t)) return false;
  return looksLikeClaim(t);
}
