import type { AnswerTier } from "../search/answer-route.ts";
import type { AnswerStageTimings, TranscriptSummary } from "./answer-latency.ts";
import { latencyPercentiles, stageValues } from "./answer-latency.ts";
import { P95_SUPPORTED_ANSWER_TARGET_MS } from "./answer-latency.ts";
import type {
  AnswerFlightRecord,
  DroppedUtteranceRecord,
  FeedbackFlightRecord,
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

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

function latencyStats(answers: AnswerFlightRecord[], key: keyof AnswerStageTimings) {
  const values = stageValues(
    answers.map((row) => row.latency as AnswerStageTimings),
    key,
  );
  return latencyPercentiles(values);
}

const TIER_LABELS: Record<AnswerTier, string> = {
  grounded: "grounded",
  synthesis: "synthesis",
  localCard: "localCard",
  silent: "silent-reason",
};

const FEEDBACK_LABELS: Record<FeedbackFlightRecord["reason"], string> = {
  "wrong-answer": "Wrong answer",
  "too-slow": "Too slow",
  "wrong-source": "Wrong source",
  "missed-context": "Missed context",
  other: "Other",
};

function formatStats(label: string, stats: { p50: number; p95: number; p99: number }): string {
  return `  ${label}: ${stats.p50} / ${stats.p95} / ${stats.p99}`;
}

const TIER_REPORT_KEYS = ["retrieveMs", "documentHydrateMs", "llmMs", "verifyMs", "totalMs"] as const;

export function formatFlightSummary(records: FlightRecord[]): string {
  const answers = records.filter((row): row is AnswerFlightRecord => row.kind === "answer");
  const dropped = records.filter((row): row is DroppedUtteranceRecord => row.kind === "dropped");
  const feedback = records.filter((row): row is FeedbackFlightRecord => row.kind === "feedback");

  const lines: string[] = ["MeetHint flight log summary", ""];

  lines.push(`Product target: p95 supported answer < ${P95_SUPPORTED_ANSWER_TARGET_MS} ms`);
  lines.push("");

  lines.push("Answers by tier");
  for (const tier of ["grounded", "synthesis", "localCard", "silent"] as const) {
    const count = answers.filter((row) => row.tier === tier).length;
    lines.push(`  ${TIER_LABELS[tier]}: ${count}`);
  }
  lines.push("");

  if (answers.length > 0) {
    lines.push("Latency by tier (ms) — p50 / p95 / p99");
    for (const tier of ["localCard", "grounded", "synthesis", "silent"] as const) {
      const subset = answers.filter((row) => row.tier === tier);
      if (subset.length === 0) {
        lines.push(`  ${TIER_LABELS[tier]}: (no samples)`);
        continue;
      }
      lines.push(`  ${TIER_LABELS[tier]} (n=${subset.length})`);
      for (const key of TIER_REPORT_KEYS) {
        const stats = latencyStats(subset, key);
        if (stats.p50 > 0 || stats.p95 > 0 || key === "totalMs") {
          lines.push(formatStats(`    ${key}`, stats));
        }
      }
    }
    lines.push("");
    lines.push("Multi-source subset (sourceCount > 1)");
    const multi = answers.filter((row) => (row.sourceCount ?? 0) > 1);
    if (multi.length === 0) {
      lines.push("  (no samples)");
    } else {
      lines.push(`  n=${multi.length}`);
      for (const key of TIER_REPORT_KEYS) {
        lines.push(formatStats(`  ${key}`, latencyStats(multi, key)));
      }
    }
    lines.push("");
    const models = new Map<string, AnswerFlightRecord[]>();
    for (const row of answers) {
      const key = `${row.provider ?? "?"}:${row.modelId ?? "?"}`;
      const bucket = models.get(key) ?? [];
      bucket.push(row);
      models.set(key, bucket);
    }
    if (models.size > 0) {
      lines.push("By provider / model");
      for (const [, rows] of models) {
        const first = rows[0]!;
        lines.push(`  ${first.provider ?? "?"} / ${first.modelName ?? first.modelId} (n=${rows.length})`);
        for (const key of ["totalMs", "llmMs", "verifyMs"] as const) {
          lines.push(formatStats(`    ${key}`, latencyStats(rows, key)));
        }
      }
      lines.push("");
    }
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
    const byReason = new Map<FeedbackFlightRecord["reason"], number>();
    for (const row of feedback) {
      byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
    }
    for (const reason of Object.keys(FEEDBACK_LABELS) as FeedbackFlightRecord["reason"][]) {
      const count = byReason.get(reason) ?? 0;
      if (count > 0) lines.push(`  ${FEEDBACK_LABELS[reason]}: ${count}`);
    }
  }

  return lines.join("\n");
}

export type { TranscriptSummary };
