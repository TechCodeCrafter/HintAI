export type BinaryLabel = string;

export type ClassificationMetrics = {
  total: number;
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  precision: Record<string, number>;
  recall: Record<string, number>;
  confusion: Record<string, Record<string, number>>;
};

export type SafetyMetrics = {
  total: number;
  accuracy: number;
  precision?: number;
  recall?: number;
  /** Label says NOT safe / NOT applicable / SILENT but judge says continue/applicable. */
  unsafeContinuation: number;
  unsafeContinuationRate: number;
  falseSilence: number;
  falseSilenceRate: number;
  falseEscalation: number;
  falseEscalationRate: number;
  falseApplicability: number;
  falseApplicabilityRate: number;
  /** Cases where judge allows continuation and continuation is correct / total. */
  safeCoverage: number;
  /** Cases where judge refuses or escalates / total. */
  refusalRate: number;
};

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)] ?? 0;
}

export function classificationMetrics(
  pairs: Array<{ expected: string; predicted: string }>,
): ClassificationMetrics {
  const labels = [...new Set(pairs.flatMap((row) => [row.expected, row.predicted]))];
  const confusion: Record<string, Record<string, number>> = {};
  for (const expected of labels) {
    confusion[expected] = {};
    for (const predicted of labels) confusion[expected][predicted] = 0;
  }
  let correct = 0;
  for (const row of pairs) {
    confusion[row.expected][row.predicted] = (confusion[row.expected][row.predicted] ?? 0) + 1;
    if (row.expected === row.predicted) correct += 1;
  }

  const precision: Record<string, number> = {};
  const recall: Record<string, number> = {};
  for (const label of labels) {
    const tp = confusion[label]?.[label] ?? 0;
    const predTotal = labels.reduce((sum, l) => sum + (confusion[l]?.[label] ?? 0), 0);
    const expTotal = labels.reduce((sum, l) => sum + (confusion[label]?.[l] ?? 0), 0);
    precision[label] = predTotal === 0 ? 0 : tp / predTotal;
    recall[label] = expTotal === 0 ? 0 : tp / expTotal;
  }

  const macroPrecision =
    labels.length === 0 ? 0 : labels.reduce((sum, l) => sum + (precision[l] ?? 0), 0) / labels.length;
  const macroRecall =
    labels.length === 0 ? 0 : labels.reduce((sum, l) => sum + (recall[l] ?? 0), 0) / labels.length;

  return {
    total: pairs.length,
    accuracy: pairs.length === 0 ? 0 : correct / pairs.length,
    precision,
    recall,
    confusion,
    macroPrecision,
    macroRecall,
  };
}

/** Applicability: unsafe = expected NOT_APPLICABLE but predicted APPLICABLE. */
export function applicabilitySafetyMetrics(
  pairs: Array<{ expected: "APPLICABLE" | "NOT_APPLICABLE"; predicted: "APPLICABLE" | "NOT_APPLICABLE" }>,
): SafetyMetrics {
  let correct = 0;
  let unsafe = 0;
  let falseSilence = 0;
  let falseApplicable = 0;
  for (const row of pairs) {
    if (row.expected === row.predicted) correct += 1;
    if (row.expected === "NOT_APPLICABLE" && row.predicted === "APPLICABLE") {
      unsafe += 1;
      falseApplicable += 1;
    }
    if (row.expected === "APPLICABLE" && row.predicted === "NOT_APPLICABLE") falseSilence += 1;
  }
  const total = pairs.length;
  const tp = pairs.filter((r) => r.expected === "APPLICABLE" && r.predicted === "APPLICABLE").length;
  const fp = pairs.filter((r) => r.expected === "NOT_APPLICABLE" && r.predicted === "APPLICABLE").length;
  const fn = falseSilence;
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const safeCoverage = total === 0 ? 0 : tp / total;
  const refusalRate = total === 0 ? 0 : (total - pairs.filter((r) => r.predicted === "APPLICABLE").length) / total;
  return {
    total,
    accuracy: total === 0 ? 0 : correct / total,
    precision,
    recall,
    unsafeContinuation: unsafe,
    unsafeContinuationRate: total === 0 ? 0 : unsafe / total,
    falseSilence,
    falseSilenceRate: total === 0 ? 0 : falseSilence / total,
    falseEscalation: 0,
    falseEscalationRate: 0,
    falseApplicability: falseApplicable,
    falseApplicabilityRate: total === 0 ? 0 : falseApplicable / total,
    safeCoverage,
    refusalRate,
  };
}

/** Escalation: unsafe = expected SILENT but predicted ANSWER or ESCALATE (continue). */
export function escalationSafetyMetrics(
  pairs: Array<{
    expected: "ANSWER_WITH_CURRENT_PIPELINE" | "ESCALATE" | "SILENT";
    predicted: "ANSWER_WITH_CURRENT_PIPELINE" | "ESCALATE" | "SILENT";
  }>,
): SafetyMetrics {
  let correct = 0;
  let unsafe = 0;
  let falseSilence = 0;
  let falseEscalation = 0;
  for (const row of pairs) {
    if (row.expected === row.predicted) correct += 1;
    const expectedSilent = row.expected === "SILENT";
    const predictedContinue = row.predicted !== "SILENT";
    if (expectedSilent && predictedContinue) unsafe += 1;
    if (row.expected !== "SILENT" && row.predicted === "SILENT") falseSilence += 1;
    if (row.expected === "ANSWER_WITH_CURRENT_PIPELINE" && row.predicted === "ESCALATE") falseEscalation += 1;
  }
  const total = pairs.length;
  const answerPred = pairs.filter((r) => r.predicted === "ANSWER_WITH_CURRENT_PIPELINE").length;
  const escalatePred = pairs.filter((r) => r.predicted === "ESCALATE").length;
  const silentPred = pairs.filter((r) => r.predicted === "SILENT").length;
  const answerExpected = pairs.filter((r) => r.expected === "ANSWER_WITH_CURRENT_PIPELINE").length;
  const answerTp = pairs.filter(
    (r) => r.expected === "ANSWER_WITH_CURRENT_PIPELINE" && r.predicted === "ANSWER_WITH_CURRENT_PIPELINE",
  ).length;
  const answerPrecision = answerPred === 0 ? 0 : answerTp / answerPred;
  const safeContinue = pairs.filter(
    (r) =>
      r.predicted !== "SILENT" &&
      (r.expected === "ANSWER_WITH_CURRENT_PIPELINE" || r.expected === "ESCALATE") &&
      r.predicted === r.expected,
  ).length;
  const safeCoverage = total === 0 ? 0 : safeContinue / total;
  const refusalRate = total === 0 ? 0 : silentPred / total;

  return {
    total,
    accuracy: total === 0 ? 0 : correct / total,
    precision: answerPrecision,
    recall: answerExpected === 0 ? 0 : answerTp / answerExpected,
    unsafeContinuation: unsafe,
    unsafeContinuationRate: total === 0 ? 0 : unsafe / total,
    falseSilence,
    falseSilenceRate: total === 0 ? 0 : falseSilence / total,
    falseEscalation,
    falseEscalationRate: total === 0 ? 0 : falseEscalation / total,
    falseApplicability: 0,
    falseApplicabilityRate: 0,
    safeCoverage,
    refusalRate,
    answerRate: total === 0 ? 0 : answerPred / total,
    escalateRate: total === 0 ? 0 : escalatePred / total,
    silentRate: total === 0 ? 0 : silentPred / total,
  } as SafetyMetrics & { answerRate: number; escalateRate: number; silentRate: number };
}

export type ThresholdSweepRow = {
  threshold: number;
  unsafeContinuationRate: number;
  correctContinuationRate: number;
  falseSilenceRate: number;
  escalationRate: number;
  silenceRate: number;
  coverageRate: number;
};

/** Re-score noul/confidence probabilities at thresholds (experimental calibration). */
export function thresholdSweep(
  rows: Array<{ confidence: number; expectedContinue: boolean }>,
  thresholds: number[],
): ThresholdSweepRow[] {
  return thresholds.map((threshold) => {
    let unsafe = 0;
    let correctContinue = 0;
    let falseSilence = 0;
    let continueCount = 0;
    let silence = 0;
    for (const row of rows) {
      const cont = row.confidence >= threshold;
      if (cont) {
        continueCount += 1;
        if (row.expectedContinue) correctContinue += 1;
        else unsafe += 1;
      } else {
        silence += 1;
        if (row.expectedContinue) falseSilence += 1;
      }
    }
    const total = rows.length || 1;
    return {
      threshold,
      unsafeContinuationRate: unsafe / total,
      correctContinuationRate: correctContinue / total,
      falseSilenceRate: falseSilence / total,
      escalationRate: continueCount / total,
      silenceRate: silence / total,
      coverageRate: continueCount / total,
    };
  });
}

/** Deterministic + Jev ensemble for applicability — Jev may only reject, never promote. */
export function ensembleApplicability(
  rows: Array<{
    deterministic: "APPLICABLE" | "NOT_APPLICABLE";
    jev: "APPLICABLE" | "NOT_APPLICABLE";
  }>,
): Array<{ expected?: "APPLICABLE" | "NOT_APPLICABLE"; predicted: "APPLICABLE" | "NOT_APPLICABLE" }> {
  return rows.map((row) => {
    let predicted: "APPLICABLE" | "NOT_APPLICABLE" = row.deterministic;
    if (row.deterministic === "APPLICABLE" && row.jev === "NOT_APPLICABLE") {
      predicted = "NOT_APPLICABLE";
    }
    return { predicted };
  });
}
