import { analyzeFlightRecords, type FlightAnalysisReport } from "./flight-analysis.ts";
import { buildSyntheticFlightSession } from "./flight-session-synth.ts";
import type { AnswerFlightRecord, FlightRecord } from "./flight-recorder.ts";
import { latencyPercentiles, stageValues, type AnswerStageTimings } from "./answer-latency.ts";
import { summarizeProgressiveAgreement, type AgreementSummary } from "./progressive-agreement.ts";

export type CompareMetric =
  | "retrieveP95"
  | "llmP95"
  | "verifyP95"
  | "totalP95"
  | "progressiveSaveP95";

export type CompareRow = {
  metric: CompareMetric;
  synthetic: number;
  real: number;
  delta: number;
};

function supportedAnswers(records: FlightRecord[]): AnswerFlightRecord[] {
  return records.filter(
    (row): row is AnswerFlightRecord => row.kind === "answer" && row.supported !== false && Boolean(row.say),
  );
}

function tierSubset(records: FlightRecord[], tiers: AnswerFlightRecord["tier"][]): AnswerFlightRecord[] {
  return supportedAnswers(records).filter((row) => tiers.includes(row.tier));
}

function p95(rows: AnswerFlightRecord[], key: keyof AnswerStageTimings): number {
  return latencyPercentiles(stageValues(rows.map((row) => row.latency as AnswerStageTimings), key)).p95;
}

function progressiveSaveP95(records: FlightRecord[]): number {
  const values = records
    .filter((row): row is AnswerFlightRecord => row.kind === "answer")
    .map((row) => row.progressive?.progressiveSaveMs)
    .filter((value): value is number => typeof value === "number" && value > 0);
  return latencyPercentiles(values).p95;
}

export function compareSyntheticVsReal(realRecords: FlightRecord[]): CompareRow[] {
  const syntheticRecords = buildSyntheticFlightSession(42);
  const synthSupported = supportedAnswers(syntheticRecords);
  const realSupported = supportedAnswers(realRecords);
  const synthLlm = tierSubset(syntheticRecords, ["grounded", "synthesis"]);
  const realLlm = tierSubset(realRecords, ["grounded", "synthesis"]);

  const metrics: Array<{ metric: CompareMetric; synthetic: number; real: number }> = [
    { metric: "retrieveP95", synthetic: p95(synthSupported, "retrieveMs"), real: p95(realSupported, "retrieveMs") },
    { metric: "llmP95", synthetic: p95(synthLlm.length ? synthLlm : synthSupported, "llmMs"), real: p95(realLlm.length ? realLlm : realSupported, "llmMs") },
    { metric: "verifyP95", synthetic: p95(synthLlm.length ? synthLlm : synthSupported, "verifyMs"), real: p95(realLlm.length ? realLlm : realSupported, "verifyMs") },
    { metric: "totalP95", synthetic: p95(synthSupported, "totalMs"), real: p95(realSupported, "totalMs") },
    { metric: "progressiveSaveP95", synthetic: progressiveSaveP95(syntheticRecords), real: progressiveSaveP95(realRecords) },
  ];

  return metrics.map((row) => ({
    ...row,
    delta: row.real - row.synthetic,
  }));
}

export function formatCompareTable(rows: CompareRow[]): string {
  const lines = ["metric | synthetic | real | delta", "---|---:|---:|---:"];
  for (const row of rows) {
    lines.push(`${row.metric} | ${row.synthetic} | ${row.real} | ${row.delta >= 0 ? "+" : ""}${row.delta}`);
  }
  return lines.join("\n");
}

export function agreementFromRecords(records: FlightRecord[]): AgreementSummary {
  return summarizeProgressiveAgreement(records.filter((row): row is AnswerFlightRecord => row.kind === "answer"));
}

export function formatAgreementSummary(summary: AgreementSummary): string {
  return [
    "Progressive agreement (shadow localCard vs final LLM answer)",
    `  comparable: ${summary.comparable}`,
    `  consistent: ${summary.consistent}`,
    `  partial: ${summary.partial}`,
    `  conflicting: ${summary.conflicting}`,
    `  agreement rate: ${(summary.agreementRate * 100).toFixed(1)}%`,
    `  safe for progressive rendering: ${summary.safeForProgressive ? "yes" : "no — needs reconciliation policy"}`,
  ].join("\n");
}

export function formatValidationReport(realRecords: FlightRecord[]): string {
  const real = analyzeFlightRecords(realRecords);
  const compare = compareSyntheticVsReal(realRecords);
  const agreement = agreementFromRecords(realRecords);
  return [
    formatCompareTable(compare),
    "",
    formatAgreementSummary(agreement),
    "",
    `Recommended 5C (real data): ${real.recommendations.recommendedStep5C}`,
    `Progressive prioritized: ${real.recommendations.progressiveRenderingPrioritized}`,
    `Routing justified: ${real.recommendations.sourceRoutingJustified}`,
  ].join("\n");
}

export type { FlightAnalysisReport };
