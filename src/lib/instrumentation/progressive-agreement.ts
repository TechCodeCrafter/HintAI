import type { AnswerTier } from "../search/answer-route.ts";

/** Privacy-safe progressive reconciliation label — no answer text stored. */
export type ProgressiveAgreement = "consistent" | "partial" | "conflicting" | "n/a";

const STOP = new Set([
  "a",
  "an",
  "the",
  "is",
  "are",
  "was",
  "were",
  "it",
  "its",
  "that",
  "this",
  "and",
  "or",
  "to",
  "of",
  "in",
  "for",
  "on",
  "with",
  "as",
  "at",
  "by",
  "from",
]);

function normalizeSay(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function contentTokens(text: string): Set<string> {
  const tokens = normalizeSay(text)
    .split(" ")
    .filter((term) => term.length > 2 && !STOP.has(term));
  return new Set(tokens);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const term of a) {
    if (b.has(term)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Compare shadow localCard vs final supported answer without persisting either string.
 * Used only at capture time to populate telemetry-safe agreement labels.
 */
export function classifyProgressiveAgreement(
  earlySay: string | null | undefined,
  finalSay: string | null | undefined,
  finalTier: AnswerTier,
): ProgressiveAgreement {
  if (finalTier === "silent" || !finalSay?.trim()) return "n/a";
  if (finalTier === "localCard") return "consistent";
  if (!earlySay?.trim()) return "n/a";

  const earlyNorm = normalizeSay(earlySay);
  const finalNorm = normalizeSay(finalSay);
  if (!earlyNorm || !finalNorm) return "n/a";
  if (earlyNorm === finalNorm) return "consistent";
  if (earlyNorm.includes(finalNorm) || finalNorm.includes(earlyNorm)) return "partial";

  const overlap = jaccard(contentTokens(earlySay), contentTokens(finalSay));
  if (overlap >= 0.55) return "partial";
  if (overlap >= 0.25) return "partial";
  return "conflicting";
}

export type AgreementSummary = {
  comparable: number;
  consistent: number;
  partial: number;
  conflicting: number;
  agreementRate: number;
  safeForProgressive: boolean;
};

export function summarizeProgressiveAgreement(
  rows: Array<{ tier: AnswerTier; progressive?: { shadowLocalCardSupported?: boolean; progressiveAgreement?: ProgressiveAgreement } }>,
): AgreementSummary {
  const comparableRows = rows.filter(
    (row) =>
      (row.tier === "grounded" || row.tier === "synthesis") &&
      row.progressive?.shadowLocalCardSupported === true &&
      row.progressive.progressiveAgreement &&
      row.progressive.progressiveAgreement !== "n/a",
  );
  let consistent = 0;
  let partial = 0;
  let conflicting = 0;
  for (const row of comparableRows) {
    const label = row.progressive!.progressiveAgreement!;
    if (label === "consistent") consistent += 1;
    else if (label === "partial") partial += 1;
    else if (label === "conflicting") conflicting += 1;
  }
  const comparable = comparableRows.length;
  const agreementRate = comparable === 0 ? 1 : (consistent + partial * 0.5) / comparable;
  return {
    comparable,
    consistent,
    partial,
    conflicting,
    agreementRate,
    safeForProgressive: comparable === 0 ? false : conflicting / comparable <= 0.05 && agreementRate >= 0.85,
  };
}
