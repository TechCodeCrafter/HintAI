import { latencyPercentiles } from "./answer-latency.ts";
import type { AnswerTier } from "../search/answer-route.ts";
import {
  type BetaFeedbackRecord,
  type BetaTelemetryRecord,
  type NegativeFeedbackCategory,
  summarizeBetaFunnel,
  summarizeBetaLifecycle,
  betaTelemetryRecords,
} from "./beta-telemetry.ts";
import type { AnswerFlightRecord, FlightRecord } from "./flight-recorder.ts";
import { parseFlightLine } from "./flight-recorder.ts";

const NEGATIVE_LABELS: Record<NegativeFeedbackCategory, string> = {
  "wrong-answer": "Wrong answer",
  "missing-context": "Missing context",
  "wrong-source": "Wrong source",
  "citation-incorrect": "Citation incorrect",
  "too-vague": "Too vague",
  "too-slow": "Too slow",
  "should-have-stayed-silent": "Should have stayed silent",
  other: "Other",
};

export type BetaQualityMetrics = {
  answerCount: number;
  supportedAnswerRate: number;
  silenceRate: number;
  usefulRate: number;
  negativeFeedbackReasons: Array<{ reason: string; count: number }>;
  latencyP50: number;
  latencyP95: number;
  tierMix: Record<AnswerTier, number>;
  averageSourcesCited: number;
  multiSourceAnswerRate: number;
  funnel: ReturnType<typeof summarizeBetaFunnel>;
  lifecycle: ReturnType<typeof summarizeBetaLifecycle>;
};

function answerRowsFromTelemetry(records: BetaTelemetryRecord[]): Array<{
  tier: AnswerTier;
  supported: boolean;
  latencyMs: number;
  sourceCount: number;
  evidenceCount: number;
}> {
  return records
    .filter((row) => row.kind === "answer")
    .map((row) => ({
      tier: row.tier,
      supported: row.supported,
      latencyMs: row.latencyMs,
      sourceCount: row.sourceCount,
      evidenceCount: row.evidenceCount,
    }));
}

function answerRowsFromFlight(records: FlightRecord[]): Array<{
  tier: AnswerTier;
  supported: boolean;
  latencyMs: number;
  sourceCount: number;
  evidenceCount: number;
}> {
  return records
    .filter((row): row is AnswerFlightRecord => row.kind === "answer")
    .map((row) => ({
      tier: row.tier,
      supported: Boolean(row.supported ?? row.say),
      latencyMs: row.latency.totalMs,
      sourceCount: row.sourceCount ?? row.sourceIds?.length ?? 0,
      evidenceCount: row.evidenceCount ?? 0,
    }));
}

export function computeBetaQualityMetrics(input?: {
  betaRecords?: BetaTelemetryRecord[];
  flightRecords?: FlightRecord[];
}): BetaQualityMetrics {
  const betaRecords = input?.betaRecords ?? betaTelemetryRecords();
  const flightRecords = input?.flightRecords;
  const answers = flightRecords?.length
    ? answerRowsFromFlight(flightRecords)
    : answerRowsFromTelemetry(betaRecords);
  const feedback = betaRecords.filter((row): row is BetaFeedbackRecord => row.kind === "feedback");
  const supported = answers.filter((row) => row.supported);
  const silent = answers.filter((row) => !row.supported);
  const latencies = supported.map((row) => row.latencyMs).sort((a, b) => a - b);
  const latency = latencyPercentiles(latencies);
  const tierMix: Record<AnswerTier, number> = {
    grounded: 0,
    synthesis: 0,
    localCard: 0,
    silent: 0,
  };
  for (const row of answers) tierMix[row.tier] += 1;
  const sourceCounts = supported.map((row) => row.sourceCount);
  const averageSourcesCited =
    sourceCounts.length === 0 ? 0 : sourceCounts.reduce((sum, value) => sum + value, 0) / sourceCounts.length;
  const multiSource = supported.filter((row) => row.sourceCount > 1).length;
  const useful = feedback.filter((row) => row.result === "useful").length;
  const negative = feedback.filter((row) => row.result === "not-useful");
  const reasonCounts = new Map<string, number>();
  for (const row of negative) {
    const key = row.failureCategory ?? "other";
    reasonCounts.set(key, (reasonCounts.get(key) ?? 0) + 1);
  }
  const total = answers.length;
  return {
    answerCount: total,
    supportedAnswerRate: total === 0 ? 0 : supported.length / total,
    silenceRate: total === 0 ? 0 : silent.length / total,
    usefulRate: supported.length === 0 ? 0 : useful / supported.length,
    negativeFeedbackReasons: [...reasonCounts.entries()]
      .map(([reason, count]) => ({ reason: NEGATIVE_LABELS[reason as NegativeFeedbackCategory] ?? reason, count }))
      .sort((a, b) => b.count - a.count),
    latencyP50: latency.p50,
    latencyP95: latency.p95,
    tierMix,
    averageSourcesCited,
    multiSourceAnswerRate: supported.length === 0 ? 0 : multiSource / supported.length,
    funnel: summarizeBetaFunnel(),
    lifecycle: summarizeBetaLifecycle(),
  };
}

export function formatBetaQualityReport(metrics: BetaQualityMetrics = computeBetaQualityMetrics()): string {
  const lines: string[] = ["MeetHint beta — Real Meeting Quality report", ""];
  lines.push("Answer quality");
  lines.push(`  supported answer rate: ${pct(metrics.supportedAnswerRate)}`);
  lines.push(`  silence rate: ${pct(metrics.silenceRate)}`);
  lines.push(`  useful rate (of supported): ${pct(metrics.usefulRate)}`);
  lines.push(`  p50 / p95 latency (supported): ${metrics.latencyP50} / ${metrics.latencyP95} ms`);
  lines.push(`  average sources cited: ${metrics.averageSourcesCited.toFixed(2)}`);
  lines.push(`  multi-source answer rate: ${pct(metrics.multiSourceAnswerRate)}`);
  lines.push("");
  lines.push("Answer tier mix");
  for (const tier of ["grounded", "synthesis", "localCard", "silent"] as const) {
    lines.push(`  ${tier}: ${metrics.tierMix[tier]}`);
  }
  lines.push("");
  lines.push("Negative feedback reasons");
  if (metrics.negativeFeedbackReasons.length === 0) {
    lines.push("  (none)");
  } else {
    for (const row of metrics.negativeFeedbackReasons) {
      lines.push(`  ${row.reason}: ${row.count}`);
    }
  }
  lines.push("");
  lines.push("Time to First Useful Answer");
  if (metrics.funnel.timeToFirstUsefulAnswerMs == null) {
    lines.push("  (incomplete funnel)");
  } else {
    lines.push(`  ${metrics.funnel.timeToFirstUsefulAnswerMs} ms`);
  }
  lines.push("");
  lines.push("Onboarding funnel (first timestamp per step)");
  for (const step of metrics.funnel.steps) {
    lines.push(`  ${step.step}: ${step.timestamp ?? "(not reached)"}`);
  }
  lines.push("");
  lines.push("Beta lifecycle counts");
  const life = metrics.lifecycle;
  lines.push(`  signup: ${life.signup}`);
  lines.push(`  source connected: ${life.sourceConnected}`);
  lines.push(`  first Knowledge Space: ${life.firstKnowledgeSpace}`);
  lines.push(`  first Ask: ${life.firstAsk}`);
  lines.push(`  first Live Session: ${life.firstLiveSession}`);
  lines.push(`  questions detected: ${life.questionsDetected}`);
  lines.push(`  supported answers: ${life.supportedAnswers}`);
  lines.push(`  silent answers: ${life.silentAnswers}`);
  lines.push(`  useful answers: ${life.usefulAnswers}`);
  lines.push(`  negative feedback: ${life.negativeFeedback}`);
  lines.push(`  sessions: ${life.sessionsPerUser}`);
  lines.push(`  return after 1 day: ${life.returnAfter1Day}`);
  lines.push(`  return after 7 days: ${life.returnAfter7Day}`);
  return lines.join("\n");
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

export function parseFlightRecordsFromText(text: string): FlightRecord[] {
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
    /* JSONL */
  }
  return trimmed
    .split("\n")
    .map((line) => parseFlightLine(line.trim()))
    .filter((row): row is FlightRecord => row != null);
}
