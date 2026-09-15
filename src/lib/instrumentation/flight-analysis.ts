/**
 * Real-session flight log analysis and optimization decision rules (Step 5B).
 * Observation only — no routing, prefetch, or model changes.
 */
import type { ModelProvider } from "../ai/models.ts";
import type { AnswerTier } from "../search/answer-route.ts";
import {
  latencyPercentiles,
  P95_SUPPORTED_ANSWER_TARGET_MS,
  stageValues,
  type AnswerStageTimings,
} from "./answer-latency.ts";
import type { AnswerFlightRecord, FlightRecord } from "./flight-recorder.ts";
import { summarizeProgressiveAgreement, type AgreementSummary } from "./progressive-agreement.ts";
import type { ProgressiveTiming } from "./progressive-timing.ts";

export const OPTIMIZATION_THRESHOLDS = {
  retrievalP95LowMs: 100,
  totalSupportedP95OkMs: P95_SUPPORTED_ANSWER_TARGET_MS,
  /** When LLM p95 exceeds this, model/prompt changes are prioritized over routing. */
  llmDominanceP95Ms: 500,
  /** When verify p95 exceeds this, profile verification specifically. */
  verifyDominanceP95Ms: 150,
  /** Minimum progressive save p95 to recommend progressive rendering. */
  progressiveSaveP95Ms: 300,
  /** Minimum samples before p95 conclusions are considered meaningful. */
  minSamplesPerTier: 5,
  /** Target sample goals for manual capture sessions. */
  captureGoals: {
    localCard: 30,
    llmTiers: 30,
    multiSource: 20,
  },
} as const;

export type TierLatencyReport = {
  tier: AnswerTier;
  sampleCount: number;
  supportedCount: number;
  retrieveMs: ReturnType<typeof latencyPercentiles>;
  documentHydrateMs: ReturnType<typeof latencyPercentiles>;
  llmMs: ReturnType<typeof latencyPercentiles>;
  verifyMs: ReturnType<typeof latencyPercentiles>;
  totalMs: ReturnType<typeof latencyPercentiles>;
};

export type ModelLatencyReport = {
  provider: ModelProvider | "unknown";
  modelId: string;
  modelName: string;
  sampleCount: number;
  tiers: Record<string, number>;
  totalMs: ReturnType<typeof latencyPercentiles>;
  llmMs: ReturnType<typeof latencyPercentiles>;
  verifyMs: ReturnType<typeof latencyPercentiles>;
};

export type ProgressiveReport = {
  samplesWithShadow: number;
  shadowSupportedCount: number;
  progressiveSaveMs: ReturnType<typeof latencyPercentiles>;
  avgSaveMs: number;
};

export type OptimizationRecommendations = {
  sourceRoutingJustified: boolean;
  sourceRoutingReason: string;
  anticipatoryRetrievalJustified: boolean;
  anticipatoryReason: string;
  progressiveRenderingPrioritized: boolean;
  progressiveReason: string;
  progressiveSafe: boolean;
  progressiveSafeReason: string;
  primaryBottleneck: string;
  recommendedStep5C: string;
  avoidUnnecessaryArchitectureChanges: boolean;
};

export type FlightAnalysisReport = {
  traceCount: number;
  answerCount: number;
  supportedCount: number;
  multiSourceCount: number;
  captureGoalStatus: {
    localCard: { have: number; target: number; met: boolean };
    llmTiers: { have: number; target: number; met: boolean };
    multiSource: { have: number; target: number; met: boolean };
  };
  byTier: TierLatencyReport[];
  multiSource: TierLatencyReport | null;
  byModel: ModelLatencyReport[];
  progressive: ProgressiveReport | null;
  agreement: AgreementSummary;
  largestP95Contributor: { stage: string; p95Ms: number; tier?: AnswerTier };
  recommendations: OptimizationRecommendations;
};

function answersOf(records: FlightRecord[]): AnswerFlightRecord[] {
  return records.filter((row): row is AnswerFlightRecord => row.kind === "answer");
}

function latencies(rows: AnswerFlightRecord[]): AnswerStageTimings[] {
  return rows.map((row) => row.latency as AnswerStageTimings);
}

function tierReport(tier: AnswerTier, rows: AnswerFlightRecord[]): TierLatencyReport {
  const lats = latencies(rows);
  return {
    tier,
    sampleCount: rows.length,
    supportedCount: rows.filter((row) => row.supported !== false && row.say).length,
    retrieveMs: latencyPercentiles(stageValues(lats, "retrieveMs")),
    documentHydrateMs: latencyPercentiles(stageValues(lats, "documentHydrateMs")),
    llmMs: latencyPercentiles(stageValues(lats, "llmMs")),
    verifyMs: latencyPercentiles(stageValues(lats, "verifyMs")),
    totalMs: latencyPercentiles(stageValues(lats, "totalMs")),
  };
}

function emptyPercentiles() {
  return { p50: 0, p95: 0, p99: 0 };
}

function modelKey(row: AnswerFlightRecord): string {
  const provider = row.provider ?? "unknown";
  const modelId = row.modelId ?? "unknown";
  return `${provider}:${modelId}`;
}

export function analyzeFlightRecords(records: FlightRecord[]): FlightAnalysisReport {
  const answers = answersOf(records);
  const supported = answers.filter((row) => row.supported !== false && row.say);
  const multiSource = answers.filter((row) => (row.sourceCount ?? 0) > 1);

  const tiers: AnswerTier[] = ["localCard", "grounded", "synthesis", "silent"];
  const byTier = tiers.map((tier) => tierReport(tier, answers.filter((row) => row.tier === tier)));

  const localCardRows = answers.filter((row) => row.tier === "localCard");
  const llmRows = answers.filter((row) => row.tier === "grounded" || row.tier === "synthesis");

  const captureGoalStatus = {
    localCard: {
      have: localCardRows.length,
      target: OPTIMIZATION_THRESHOLDS.captureGoals.localCard,
      met: localCardRows.length >= OPTIMIZATION_THRESHOLDS.captureGoals.localCard,
    },
    llmTiers: {
      have: llmRows.length,
      target: OPTIMIZATION_THRESHOLDS.captureGoals.llmTiers,
      met: llmRows.length >= OPTIMIZATION_THRESHOLDS.captureGoals.llmTiers,
    },
    multiSource: {
      have: multiSource.length,
      target: OPTIMIZATION_THRESHOLDS.captureGoals.multiSource,
      met: multiSource.length >= OPTIMIZATION_THRESHOLDS.captureGoals.multiSource,
    },
  };

  const multiSourceCombined: TierLatencyReport | null =
    multiSource.length > 0
      ? {
          tier: "localCard",
          sampleCount: multiSource.length,
          supportedCount: multiSource.filter((row) => row.say).length,
          retrieveMs: latencyPercentiles(stageValues(latencies(multiSource), "retrieveMs")),
          documentHydrateMs: latencyPercentiles(stageValues(latencies(multiSource), "documentHydrateMs")),
          llmMs: latencyPercentiles(stageValues(latencies(multiSource), "llmMs")),
          verifyMs: latencyPercentiles(stageValues(latencies(multiSource), "verifyMs")),
          totalMs: latencyPercentiles(stageValues(latencies(multiSource), "totalMs")),
        }
      : null;

  const modelMap = new Map<string, AnswerFlightRecord[]>();
  for (const row of answers) {
    const key = modelKey(row);
    const bucket = modelMap.get(key) ?? [];
    bucket.push(row);
    modelMap.set(key, bucket);
  }

  const byModel: ModelLatencyReport[] = [...modelMap.entries()]
    .map(([key, rows]) => {
      const lats = latencies(rows);
      const tiersSeen: Record<string, number> = {};
      for (const row of rows) tiersSeen[row.tier] = (tiersSeen[row.tier] ?? 0) + 1;
      const first = rows[0]!;
      return {
        provider: (first.provider ?? "unknown") as ModelProvider | "unknown",
        modelId: first.modelId ?? "unknown",
        modelName: first.modelName ?? first.modelId ?? "unknown",
        sampleCount: rows.length,
        tiers: tiersSeen,
        totalMs: latencyPercentiles(stageValues(lats, "totalMs")),
        llmMs: latencyPercentiles(stageValues(lats, "llmMs")),
        verifyMs: latencyPercentiles(stageValues(lats, "verifyMs")),
      };
    })
    .sort((a, b) => b.sampleCount - a.sampleCount);

  const progressiveRows = answers.filter((row) => row.progressive?.shadowLocalCardSupported != null);
  const saveValues = progressiveRows
    .map((row) => row.progressive?.progressiveSaveMs)
    .filter((value): value is number => typeof value === "number" && value > 0);
  const progressive: ProgressiveReport | null =
    progressiveRows.length > 0
      ? {
          samplesWithShadow: progressiveRows.length,
          shadowSupportedCount: progressiveRows.filter((row) => row.progressive?.shadowLocalCardSupported).length,
          progressiveSaveMs: latencyPercentiles(saveValues),
          avgSaveMs: saveValues.length ? saveValues.reduce((a, b) => a + b, 0) / saveValues.length : 0,
        }
      : null;

  const largestP95Contributor = findLargestP95Contributor(supported.length ? supported : answers);
  const agreement = summarizeProgressiveAgreement(answers);
  const recommendations = deriveRecommendations({
    byTier,
    supported,
    multiSourceCombined,
    progressive,
    agreement,
    largestP95Contributor,
    captureGoalStatus,
  });

  return {
    traceCount: answers.length,
    answerCount: answers.length,
    supportedCount: supported.length,
    multiSourceCount: multiSource.length,
    captureGoalStatus,
    byTier,
    multiSource: multiSourceCombined,
    byModel,
    progressive,
    agreement,
    largestP95Contributor,
    recommendations,
  };
}

function findLargestP95Contributor(rows: AnswerFlightRecord[]): {
  stage: string;
  p95Ms: number;
  tier?: AnswerTier;
} {
  const stages: (keyof AnswerStageTimings)[] = [
    "retrieveMs",
    "documentHydrateMs",
    "llmMs",
    "verifyMs",
    "localCardMs",
    "routeMs",
    "totalMs",
  ];
  let best = { stage: "totalMs", p95Ms: 0 as number, tier: undefined as AnswerTier | undefined };
  for (const stage of stages) {
    const p95 = latencyPercentiles(stageValues(latencies(rows), stage)).p95;
    if (p95 > best.p95Ms) {
      best = { stage, p95Ms: p95, tier: undefined };
    }
  }
  for (const tier of ["localCard", "grounded", "synthesis"] as const) {
    const subset = rows.filter((row) => row.tier === tier);
    if (subset.length === 0) continue;
    const llmP95 = latencyPercentiles(stageValues(latencies(subset), "llmMs")).p95;
    if (llmP95 > best.p95Ms) best = { stage: "llmMs", p95Ms: llmP95, tier };
  }
  return best;
}

function deriveRecommendations(input: {
  byTier: TierLatencyReport[];
  supported: AnswerFlightRecord[];
  multiSourceCombined: TierLatencyReport | null;
  progressive: ProgressiveReport | null;
  agreement: AgreementSummary;
  largestP95Contributor: { stage: string; p95Ms: number };
  captureGoalStatus: FlightAnalysisReport["captureGoalStatus"];
}): OptimizationRecommendations {
  const supportedLats = latencies(input.supported);
  const retrievalP95 = latencyPercentiles(stageValues(supportedLats, "retrieveMs")).p95;
  const llmP95 = latencyPercentiles(stageValues(supportedLats, "llmMs")).p95;
  const verifyP95 = latencyPercentiles(stageValues(supportedLats, "verifyMs")).p95;
  const totalP95 = latencyPercentiles(stageValues(supportedLats, "totalMs")).p95;

  const multiRetrieveP95 = input.multiSourceCombined?.retrieveMs.p95 ?? retrievalP95;

  const sourceRoutingJustified =
    retrievalP95 >= OPTIMIZATION_THRESHOLDS.retrievalP95LowMs ||
    multiRetrieveP95 >= OPTIMIZATION_THRESHOLDS.retrievalP95LowMs * 2;
  const sourceRoutingReason = sourceRoutingJustified
    ? `Retrieval p95 (${Math.max(retrievalP95, multiRetrieveP95)} ms) exceeds ${OPTIMIZATION_THRESHOLDS.retrievalP95LowMs} ms threshold on realistic corpora.`
    : `Retrieval p95 (${retrievalP95} ms overall, ${multiRetrieveP95} ms multi-source) stays below ${OPTIMIZATION_THRESHOLDS.retrievalP95LowMs} ms — routing not justified for latency.`;

  const anticipatoryRetrievalJustified =
    sourceRoutingJustified && multiRetrieveP95 > retrievalP95 * 1.5;
  const anticipatoryReason = anticipatoryRetrievalJustified
    ? "Multi-source retrieval p95 grows materially vs single-source — prefetch may help after routing exists."
    : "Retrieval cost does not scale materially with source count in captured data — anticipatory retrieval not justified yet.";

  const progressiveSaveP95 = input.progressive?.progressiveSaveMs.p95 ?? 0;
  const hasOpportunity = progressiveSaveP95 >= OPTIMIZATION_THRESHOLDS.progressiveSaveP95Ms;
  const progressiveSafe = input.agreement.safeForProgressive;
  const progressiveRenderingPrioritized = hasOpportunity && progressiveSafe;
  const progressiveReason = !hasOpportunity
    ? progressiveSaveP95 > 0
      ? `Progressive save p95 (${progressiveSaveP95} ms) below ${OPTIMIZATION_THRESHOLDS.progressiveSaveP95Ms} ms priority threshold.`
      : "No progressive opportunity observed — shadow localCard rarely beats LLM tier on captured traces."
    : !progressiveSafe
      ? input.agreement.conflicting > 0
        ? `Early localCard conflicts with final LLM answer on ${input.agreement.conflicting}/${input.agreement.comparable} traces — do not ship without reconciliation.`
        : `Early localCard only ${(input.agreement.agreementRate * 100).toFixed(0)}% aligned with final LLM answers — partial mismatches need a reconciliation policy.`
      : `Shadow localCard could appear ${progressiveSaveP95} ms earlier (p95) with ${(input.agreement.agreementRate * 100).toFixed(0)}% agreement.`;
  const progressiveSafeReason = progressiveSafe
    ? `Agreement rate ${(input.agreement.agreementRate * 100).toFixed(1)}% with ≤5% conflicting (${input.agreement.conflicting}/${input.agreement.comparable}).`
    : input.agreement.conflicting > 0
      ? `Conflicting early vs final answers on ${input.agreement.conflicting}/${input.agreement.comparable} traces — too high for blind early render.`
      : `Agreement rate ${(input.agreement.agreementRate * 100).toFixed(1)}% on ${input.agreement.comparable} comparable traces is below the 85% safety threshold (partial answers differ materially).`;

  const avoidUnnecessaryArchitectureChanges = totalP95 < OPTIMIZATION_THRESHOLDS.totalSupportedP95OkMs;

  let primaryBottleneck = input.largestP95Contributor.stage;
  if (llmP95 >= verifyP95 && llmP95 >= retrievalP95) primaryBottleneck = "llmMs";
  else if (verifyP95 > llmP95 && verifyP95 > retrievalP95) primaryBottleneck = "verifyMs";
  else if (retrievalP95 > llmP95) primaryBottleneck = "retrieveMs";

  let recommendedStep5C: string;
  if (avoidUnnecessaryArchitectureChanges && !sourceRoutingJustified) {
    if (llmP95 >= OPTIMIZATION_THRESHOLDS.llmDominanceP95Ms) {
      recommendedStep5C = progressiveRenderingPrioritized
        ? "5C-progressive: show shadow localCard immediately while LLM tier completes; defer routing/prefetch."
        : hasOpportunity && !progressiveSafe
          ? "5C-reconciliation: define early-answer vs final-answer policy before progressive rendering."
          : "5C-llm-tuning: model selection, prompt length, and streaming first token — not source routing.";
    } else if (verifyP95 >= OPTIMIZATION_THRESHOLDS.verifyDominanceP95Ms) {
      recommendedStep5C = "5C-verification: profile verifyClaim / evidence-span hot paths.";
    } else {
      recommendedStep5C = "5C-measure-more: total p95 already under target; collect more LLM-tier sessions before architecture changes.";
    }
  } else if (sourceRoutingJustified) {
    recommendedStep5C = "5C-routing: intelligent source routing with measured retrieval cost as primary driver.";
  } else {
    recommendedStep5C = "5C-llm-tuning: LLM p95 dominates retrieval; optimize generation path first.";
  }

  return {
    sourceRoutingJustified,
    sourceRoutingReason,
    anticipatoryRetrievalJustified,
    anticipatoryReason,
    progressiveRenderingPrioritized,
    progressiveReason,
    progressiveSafe,
    progressiveSafeReason,
    primaryBottleneck,
    recommendedStep5C,
    avoidUnnecessaryArchitectureChanges,
  };
}

function formatPercentiles(stats: { p50: number; p95: number; p99: number }, n: number): string {
  if (n === 0) return "(no samples)";
  return `p50/p95/p99 = ${stats.p50} / ${stats.p95} / ${stats.p99} ms (n=${n})`;
}

export function formatTierReport(report: TierLatencyReport): string[] {
  if (report.sampleCount === 0) return [`${report.tier}: (no samples)`];
  return [
    `${report.tier} (n=${report.sampleCount}, supported=${report.supportedCount})`,
    `  retrieveMs:      ${formatPercentiles(report.retrieveMs, report.sampleCount)}`,
    `  documentHydrate: ${formatPercentiles(report.documentHydrateMs, report.sampleCount)}`,
    `  llmMs:           ${formatPercentiles(report.llmMs, report.sampleCount)}`,
    `  verifyMs:        ${formatPercentiles(report.verifyMs, report.sampleCount)}`,
    `  totalMs:         ${formatPercentiles(report.totalMs, report.sampleCount)}`,
  ];
}

export function formatFlightAnalysis(report: FlightAnalysisReport): string {
  const lines: string[] = [
    "MeetHint flight analysis (Step 5B)",
    "",
    `Traces analyzed: ${report.traceCount}`,
    `Supported answers: ${report.supportedCount}`,
    `Multi-source answers: ${report.multiSourceCount}`,
    "",
    "Capture goal status",
    `  localCard:     ${report.captureGoalStatus.localCard.have}/${report.captureGoalStatus.localCard.target} ${report.captureGoalStatus.localCard.met ? "✓" : "(need more)"}`,
    `  grounded+synth: ${report.captureGoalStatus.llmTiers.have}/${report.captureGoalStatus.llmTiers.target} ${report.captureGoalStatus.llmTiers.met ? "✓" : "(need more)"}`,
    `  multi-source:  ${report.captureGoalStatus.multiSource.have}/${report.captureGoalStatus.multiSource.target} ${report.captureGoalStatus.multiSource.met ? "✓" : "(need more)"}`,
    "",
    `Product target: p95 supported totalMs < ${P95_SUPPORTED_ANSWER_TARGET_MS} ms`,
    "",
    "By answer tier",
  ];

  for (const tier of report.byTier) {
    lines.push(...formatTierReport(tier));
    lines.push("");
  }

  if (report.multiSource) {
    lines.push("Multi-source subset (all tiers)");
    lines.push(...formatTierReport({ ...report.multiSource, tier: "localCard" as AnswerTier }));
    lines.push("");
  }

  if (report.byModel.length > 0) {
    lines.push("By provider / model");
    for (const model of report.byModel) {
      lines.push(
        `  ${model.provider} / ${model.modelName} (${model.modelId}) n=${model.sampleCount} tiers=${JSON.stringify(model.tiers)}`,
      );
      lines.push(`    totalMs: ${formatPercentiles(model.totalMs, model.sampleCount)}`);
      lines.push(`    llmMs:   ${formatPercentiles(model.llmMs, model.sampleCount)}`);
      lines.push(`    verifyMs:${formatPercentiles(model.verifyMs, model.sampleCount)}`);
    }
    lines.push("");
  }

  if (report.progressive) {
    lines.push("Progressive answer opportunity (observation only)");
    lines.push(`  shadow samples: ${report.progressive.samplesWithShadow}`);
    lines.push(`  shadow localCard supported: ${report.progressive.shadowSupportedCount}`);
    lines.push(`  progressiveSaveMs: ${formatPercentiles(report.progressive.progressiveSaveMs, report.progressive.samplesWithShadow)}`);
    lines.push(`  avg save when applicable: ${Math.round(report.progressive.avgSaveMs)} ms`);
    lines.push("");
  }

  lines.push("Shadow localCard vs final answer agreement");
  lines.push(`  comparable LLM traces: ${report.agreement.comparable}`);
  lines.push(`  consistent: ${report.agreement.consistent}`);
  lines.push(`  partial: ${report.agreement.partial}`);
  lines.push(`  conflicting: ${report.agreement.conflicting}`);
  lines.push(`  agreement rate: ${(report.agreement.agreementRate * 100).toFixed(1)}%`);
  lines.push(`  safe for progressive: ${report.agreement.safeForProgressive}`);
  lines.push("");

  lines.push("Optimization decision");
  lines.push(`  Largest p95 contributor: ${report.largestP95Contributor.stage} (${report.largestP95Contributor.p95Ms} ms)`);
  lines.push(`  Primary bottleneck: ${report.recommendations.primaryBottleneck}`);
  lines.push(`  Source routing justified: ${report.recommendations.sourceRoutingJustified}`);
  lines.push(`    → ${report.recommendations.sourceRoutingReason}`);
  lines.push(`  Anticipatory retrieval justified: ${report.recommendations.anticipatoryRetrievalJustified}`);
  lines.push(`    → ${report.recommendations.anticipatoryReason}`);
  lines.push(`  Progressive rendering prioritized: ${report.recommendations.progressiveRenderingPrioritized}`);
  lines.push(`    → ${report.recommendations.progressiveReason}`);
  lines.push(`  Progressive rendering safe: ${report.recommendations.progressiveSafe}`);
  lines.push(`    → ${report.recommendations.progressiveSafeReason}`);
  lines.push(`  Avoid unnecessary architecture changes: ${report.recommendations.avoidUnnecessaryArchitectureChanges}`);
  lines.push(`  Recommended Step 5C: ${report.recommendations.recommendedStep5C}`);

  return lines.join("\n");
}

export type { ProgressiveTiming };
