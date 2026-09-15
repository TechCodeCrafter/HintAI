import type { AnswerFlightRecord } from "./flight-recorder.ts";

/** Privacy-safe fast-path semantic quality labels (Step 5D). */
export type FastPathSemanticClass =
  | "semantically equivalent"
  | "equivalent but narrower"
  | "equivalent but more precise"
  | "materially incomplete"
  | "conflicting";

const STOP = new Set([
  "a", "an", "the", "is", "are", "was", "were", "it", "its", "that", "this",
  "and", "or", "to", "of", "in", "for", "on", "with", "as", "at", "by", "from",
]);

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((term) => term.length > 2 && !STOP.has(term)),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const term of a) if (b.has(term)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

export function classifyFastPathSemanticQuality(
  baselineSay: string | null | undefined,
  fastPathSay: string | null | undefined,
): FastPathSemanticClass {
  if (!baselineSay?.trim() || !fastPathSay?.trim()) return "materially incomplete";
  const baselineNorm = baselineSay.toLowerCase().replace(/\s+/g, " ").trim();
  const fastNorm = fastPathSay.toLowerCase().replace(/\s+/g, " ").trim();
  if (baselineNorm === fastNorm) return "semantically equivalent";
  if (baselineNorm.includes(fastNorm) || fastNorm.includes(baselineNorm)) {
    return fastNorm.length < baselineNorm.length * 0.75
      ? "equivalent but narrower"
      : "equivalent but more precise";
  }
  const overlap = jaccard(tokens(baselineSay), tokens(fastPathSay));
  if (overlap >= 0.65) return "semantically equivalent";
  if (overlap >= 0.45) {
    return fastNorm.length < baselineNorm.length * 0.8
      ? "equivalent but narrower"
      : "semantically equivalent";
  }
  if (overlap >= 0.3) return "equivalent but narrower";
  if (overlap < 0.2) return "conflicting";
  return "equivalent but narrower";
}

export type FastPathQualitySummary = {
  bypassed: number;
  acceptable: number;
  acceptableRate: number;
  conflicting: number;
  incomplete: number;
  byClass: Record<FastPathSemanticClass, number>;
  passesThreshold: boolean;
};

function captureKey(row: Pick<AnswerFlightRecord, "captureScenario" | "query">): string {
  return `${row.captureScenario ?? ""}::${row.query}`;
}

/** Compare bypassed optimized traces to baseline finals — counts only, no answer text. */
export function summarizeFastPathQuality(
  baseline: AnswerFlightRecord[],
  optimized: AnswerFlightRecord[],
  acceptableThreshold = 0.9,
): FastPathQualitySummary {
  const baseMap = new Map(
    baseline.filter((row) => row.kind === "answer").map((row) => [captureKey(row), row]),
  );
  const bypassed = optimized.filter((row) => row.kind === "answer" && row.llmBypassed);

  const byClass: Record<FastPathSemanticClass, number> = {
    "semantically equivalent": 0,
    "equivalent but narrower": 0,
    "equivalent but more precise": 0,
    "materially incomplete": 0,
    conflicting: 0,
  };

  for (const row of bypassed) {
    const prior = baseMap.get(captureKey(row));
    const cls = classifyFastPathSemanticQuality(prior?.say ?? null, row.say);
    byClass[cls] += 1;
  }

  const acceptable =
    byClass["semantically equivalent"] +
    byClass["equivalent but narrower"] +
    byClass["equivalent but more precise"];
  const bypassedCount = bypassed.length;
  const acceptableRate = bypassedCount === 0 ? 1 : acceptable / bypassedCount;

  return {
    bypassed: bypassedCount,
    acceptable,
    acceptableRate,
    conflicting: byClass.conflicting,
    incomplete: byClass["materially incomplete"],
    byClass,
    passesThreshold:
      byClass.conflicting === 0 &&
      acceptableRate >= acceptableThreshold,
  };
}

/** Multi-source scenario support — space has 2+ sources, answer is supported. */
export function countSupportedMultiSourceScenarios(rows: AnswerFlightRecord[]): number {
  const multiScenarios = new Set(["multi-repo", "repo-pdf", "synthesis-heavy"]);
  return rows.filter(
    (row) =>
      row.kind === "answer" &&
      row.supported &&
      Boolean(row.say) &&
      multiScenarios.has(row.captureScenario ?? ""),
  ).length;
}
