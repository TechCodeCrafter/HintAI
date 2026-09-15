import type { ProgressiveAgreement } from "./progressive-agreement.ts";
import type { AnswerTier } from "../search/answer-route.ts";

/** Observation-only progressive answer opportunity (no rendering change). */
export type ProgressiveTiming = {
  /** ms from search() start when shadow localCard first produces a supported answer. */
  earliestSupportedMs?: number | null;
  /** ms when the tier actually returned to the user (= latency.totalMs). */
  finalAnswerMs: number;
  /**
   * ms that could be saved if localCard answer were shown before LLM tier completes.
   * Set only when shadow localCard succeeded but final tier was grounded/synthesis.
   */
  progressiveSaveMs?: number | null;
  shadowLocalCardSupported: boolean;
  shadowLocalCardMs?: number;
  /** Shadow localCard vs final answer — no answer text stored. */
  progressiveAgreement?: ProgressiveAgreement;
};

export function buildProgressiveTiming(input: {
  tier: AnswerTier;
  totalMs: number;
  shadowLocalCardSupported: boolean;
  earliestSupportedMs?: number | null;
  shadowLocalCardMs?: number;
  progressiveAgreement?: ProgressiveAgreement;
}): ProgressiveTiming {
  const finalAnswerMs = input.totalMs;
  const llmTier = input.tier === "grounded" || input.tier === "synthesis";
  const progressiveSaveMs =
    llmTier &&
    input.shadowLocalCardSupported &&
    input.earliestSupportedMs != null &&
    finalAnswerMs > input.earliestSupportedMs
      ? finalAnswerMs - input.earliestSupportedMs
      : null;

  return {
    earliestSupportedMs: input.shadowLocalCardSupported ? (input.earliestSupportedMs ?? null) : null,
    finalAnswerMs,
    progressiveSaveMs,
    shadowLocalCardSupported: input.shadowLocalCardSupported,
    shadowLocalCardMs: input.shadowLocalCardMs,
    progressiveAgreement: input.progressiveAgreement,
  };
}
