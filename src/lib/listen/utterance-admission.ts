/**
 * Silero sits on top of energy VAD: energy segments the stream; this module
 * decides whether a segment may reach ASR.
 *
 * TUNING PROTOCOL — if the speech e2e breaks, lower SPEECH_PROB_THRESHOLD in
 * steps of 0.05; if noise still leaks, raise it. The speech test is the floor,
 * the noise test is the ceiling — CI proves the band holds.
 */

/** Mean Silero isSpeech needed to admit when the model has scored the clip. */
export const SPEECH_PROB_THRESHOLD = 0.5;

/** Fallback when Silero is not ready: RMS must clear gate × this. */
export const HIGH_ENERGY_GATE_MULTIPLIER = 2.5;

export const HIGH_ENERGY_MIN_DURATION_MS = 1000;

export type DropReason = "silero-low-prob" | "energy-vad";

export type UtteranceAdmissionInput = {
  meanSileroProb: number | null;
  durationMs: number;
  energyRms: number;
  gate: number;
};

export type UtteranceAdmissionResult =
  | { admit: true; via: "silero" | "high-energy" }
  | {
      admit: false;
      reason: DropReason;
      sileroProb: number | null;
      durationMs: number;
      energy: number;
    };

export function judgeUtteranceAdmission(input: UtteranceAdmissionInput): UtteranceAdmissionResult {
  const { meanSileroProb, durationMs, energyRms, gate } = input;
  const energy = energyRms;

  if (meanSileroProb != null) {
    if (meanSileroProb >= SPEECH_PROB_THRESHOLD) {
      return { admit: true, via: "silero" };
    }
    return {
      admit: false,
      reason: "silero-low-prob",
      sileroProb: meanSileroProb,
      durationMs,
      energy,
    };
  }

  const highEnergy = energyRms >= gate * HIGH_ENERGY_GATE_MULTIPLIER;
  if (highEnergy && durationMs >= HIGH_ENERGY_MIN_DURATION_MS) {
    return { admit: true, via: "high-energy" };
  }

  return {
    admit: false,
    reason: "silero-low-prob",
    sileroProb: null,
    durationMs,
    energy,
  };
}

export function meanSileroProb(sum: number, count: number): number | null {
  return count > 0 ? sum / count : null;
}
