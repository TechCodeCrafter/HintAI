import type { AnswerTier } from "../search/answer-route.ts";
import type {
  AnswerFlightRecord,
  DroppedUtteranceRecord,
  FeedbackFlightRecord,
  FeedbackReason,
  FlightRecord,
} from "./flight-recorder.ts";
import { parseFlightLine } from "./flight-recorder.ts";

export function parseFlightInput(text: string): FlightRecord[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed) as { records?: unknown[] };
    if (Array.isArray(parsed.records)) {
      return parsed.records
        .map((row) => parseFlightLine(JSON.stringify(row)))
        .filter((row): row is FlightRecord => row != null);
    }
  } catch {
    /* JSONL or malformed JSON */
  }
  return trimmed
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseFlightLine)
    .filter((row): row is FlightRecord => row != null);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]!;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function latencyStats(answers: AnswerFlightRecord[], key: keyof AnswerFlightRecord["latency"]) {
  const values = answers.map((row) => row.latency[key]).sort((a, b) => a - b);
  return {
    p50: percentile(values, 50),
    p95: percentile(values, 95),
    p99: percentile(values, 99),
  };
}

const TIER_LABELS: Record<AnswerTier, string> = {
  grounded: "grounded",
  synthesis: "synthesis",
  localCard: "localCard",
  silent: "silent-reason",
};

const FEEDBACK_LABELS: Record<FeedbackReason, string> = {
  "wrong-answer": "Wrong answer",
  "too-slow": "Too slow",
  "wrong-source": "Wrong source",
  "missed-context": "Missed context",
  other: "Other",
};

export function formatFlightSummary(records: FlightRecord[]): string {
  const answers = records.filter((row): row is AnswerFlightRecord => row.kind === "answer");
  const dropped = records.filter((row): row is DroppedUtteranceRecord => row.kind === "dropped");
  const feedback = records.filter((row): row is FeedbackFlightRecord => row.kind === "feedback");

  const lines: string[] = ["MeetHint flight log summary", ""];

  lines.push("Answers by tier");
  for (const tier of ["grounded", "synthesis", "localCard", "silent"] as const) {
    const count = answers.filter((row) => row.tier === tier).length;
    lines.push(`  ${TIER_LABELS[tier]}: ${count}`);
  }
  lines.push("");

  if (answers.length > 0) {
    lines.push("Latency (ms) — p50 / p95 / p99");
    for (const key of ["retrieveMs", "llmMs", "verifyMs", "totalMs"] as const) {
      const stats = latencyStats(answers, key);
      lines.push(`  ${key}: ${stats.p50} / ${stats.p95} / ${stats.p99}`);
    }
    lines.push("");
  } else {
    lines.push("Latency: (no answer records)");
    lines.push("");
  }

  lines.push("Dropped utterances");
  if (dropped.length === 0) {
    lines.push("  (none)");
  } else {
    const byReason = new Map<string, number>();
    for (const row of dropped) {
      byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
    }
    for (const [reason, count] of [...byReason.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`  ${reason}: ${count}`);
    }
    const probs = dropped.map((row) => row.sileroProb).filter((value): value is number => value != null);
    if (probs.length > 0) {
      const sorted = [...probs].sort((a, b) => a - b);
      lines.push(
        `  sileroProb min/median/max: ${sorted[0]!.toFixed(3)} / ${median(probs).toFixed(3)} / ${sorted.at(-1)!.toFixed(3)}`,
      );
    } else {
      lines.push("  sileroProb min/median/max: (no scores)");
    }
  }
  lines.push("");

  lines.push("Feedback");
  if (feedback.length === 0) {
    lines.push("  (none)");
  } else {
    const byReason = new Map<FeedbackReason, number>();
    for (const row of feedback) {
      byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
    }
    for (const reason of Object.keys(FEEDBACK_LABELS) as FeedbackReason[]) {
      const count = byReason.get(reason) ?? 0;
      if (count > 0) lines.push(`  ${FEEDBACK_LABELS[reason]}: ${count}`);
    }
  }

  return lines.join("\n");
}
