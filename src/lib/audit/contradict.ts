import type { Claim, MeetingRecord } from "./types.ts";

const STOP = new Set([
  "a", "an", "and", "are", "as", "at", "be", "been", "by", "can", "for", "from",
  "in", "is", "it", "of", "on", "or", "our", "that", "the", "their", "them",
  "they", "this", "to", "we", "will", "with", "would", "should", "could",
]);

const NEGATION = new Set([
  "not", "never", "no", "nor", "neither", "without", "cannot",
]);

const ANTONYMS: Array<[string, string]> = [
  ["deprecate", "keep"],
  ["drop", "keep"],
  ["remove", "keep"],
  ["cancel", "keep"],
  ["ship", "delay"],
  ["ship", "postpone"],
  ["enable", "disable"],
  ["allow", "block"],
  ["allow", "deny"],
  ["increase", "decrease"],
  ["more", "less"],
  ["before", "after"],
  ["start", "stop"],
  ["accept", "reject"],
  ["yes", "no"],
];

const SCHEDULE = new Set([
  "ship", "shipping", "timeline", "deadline", "schedule", "date", "earliest",
  "latest", "friday", "monday", "tuesday", "wednesday", "thursday", "saturday",
  "sunday", "q1", "q2", "q3", "q4", "week", "month", "quarter",
]);

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/won't/g, "will not")
    .replace(/don't/g, "do not")
    .replace(/can't/g, "can not")
    .replace(/n't/g, " not")
    .replace(/[^a-z0-9.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text: string): string[] {
  return normalize(text).split(" ").filter(Boolean);
}

function keywords(text: string): Set<string> {
  return new Set(tokens(text).filter((word) => word.length > 2 && !STOP.has(word) && !NEGATION.has(word)));
}

function sharedKeywords(a: string, b: string): string[] {
  const other = keywords(b);
  return [...keywords(a)].filter((word) => other.has(word));
}

function negated(text: string): boolean {
  return tokens(text).some((word) => NEGATION.has(word));
}

function quantities(text: string): string[] {
  const found = normalize(text).match(/\d+(?:\.\d+)?k?|\bq[1-4]\b/g) ?? [];
  return [...new Set(found)];
}

function hasAntonymPair(a: string, b: string): boolean {
  const left = keywords(a);
  const right = keywords(b);
  return ANTONYMS.some(
    ([x, y]) => (left.has(x) && right.has(y)) || (left.has(y) && right.has(x)),
  );
}

function scheduleClash(a: string, b: string): boolean {
  const left = keywords(a);
  const right = keywords(b);
  const leftTime = [...left].filter((word) => SCHEDULE.has(word) || /^\d/.test(word) || /^q[1-4]$/.test(word));
  const rightTime = [...right].filter((word) => SCHEDULE.has(word) || /^\d/.test(word) || /^q[1-4]$/.test(word));
  if (leftTime.length === 0 || rightTime.length === 0) return false;
  const topical =
    [...left].some((word) => SCHEDULE.has(word)) && [...right].some((word) => SCHEDULE.has(word));
  if (!topical) return false;
  return leftTime.some((word) => !rightTime.includes(word)) || rightTime.some((word) => !leftTime.includes(word));
}

function scheduleTalk(text: string): boolean {
  return [...keywords(text)].some((word) => SCHEDULE.has(word));
}

function relatedClaims(current: Claim, past: Claim): boolean {
  if (current.speaker.toLowerCase() === past.speaker.toLowerCase()) return true;
  if (sharedKeywords(current.text, past.text).length >= 2) return true;
  return scheduleTalk(current.text) && scheduleTalk(past.text);
}

/** True when the two lines cannot both stand. Not "no hit." */
export function saysOpposite(current: string, past: string): boolean {
  const overlap = sharedKeywords(current, past);
  if (hasAntonymPair(current, past) && overlap.length >= 1) return true;
  if (negated(current) !== negated(past) && overlap.length >= 1) return true;
  const currentQty = quantities(current);
  const pastQty = quantities(past);
  if (currentQty.length > 0 && pastQty.length > 0 && overlap.length >= 1) {
    const same = currentQty.every((q) => pastQty.includes(q)) && pastQty.every((q) => currentQty.includes(q));
    if (!same) return true;
  }
  if (scheduleClash(current, past)) return true;
  return false;
}

/**
 * If a past supported claim cannot both be true with this line, return the
 * current claim marked contradicted. Otherwise null.
 */
export function detectContradictions(currentClaim: Claim, history: MeetingRecord[]): Claim | null {
  const related: string[] = [];
  for (const meeting of history) {
    for (const past of meeting.claims) {
      if (past.id === currentClaim.id) continue;
      if (past.status !== "supported") continue;
      if (!relatedClaims(currentClaim, past)) continue;
      if (!saysOpposite(currentClaim.text, past.text)) continue;
      related.push(past.id);
    }
  }
  if (related.length === 0) return null;
  return {
    ...currentClaim,
    status: "contradicted",
    relatedClaimIds: [...new Set([...currentClaim.relatedClaimIds, ...related])],
  };
}

export function findHistoryClaim(
  id: string,
  history: MeetingRecord[],
): { claim: Claim; meeting: MeetingRecord } | null {
  for (const meeting of history) {
    const claim = meeting.claims.find((item) => item.id === id);
    if (claim) return { claim, meeting };
  }
  return null;
}
