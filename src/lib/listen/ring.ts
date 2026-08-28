/**
 * The per-lane pre-roll ring: the most recent audio, always retained, so a clip
 * can begin before the frame on which speech was finally detected.
 *
 * The contract is a floor, not a target. `preRollMs` is a promise to retain AT
 * LEAST that much audio, so the ring holds whole frames up to the first one that
 * covers the request. Evicting while `total > budget` — the previous rule —
 * quietly retained less than asked: with 128ms frames a 500ms request kept three
 * frames, 384ms, and the missing 116ms was opening speech.
 *
 * Accounting is in samples. Durations are derived only at the edges, so
 * repeated float addition can never drift the budget.
 */

export type Ring = {
  frames: Float32Array[];
  /** Total samples currently retained, maintained incrementally. */
  samples: number;
};

export function newRing(): Ring {
  return { frames: [], samples: 0 };
}

/** Samples needed to cover `ms`, rounding up so the request is never undershot. */
export function keepSamplesFor(ms: number, sampleRate: number): number {
  if (!(ms > 0) || !(sampleRate > 0)) return 0;
  return Math.ceil((ms / 1000) * sampleRate);
}

export function ringMs(ring: Ring, sampleRate: number): number {
  if (!(sampleRate > 0)) return 0;
  return (ring.samples / sampleRate) * 1000;
}

/**
 * Appends a frame, then drops the oldest frames only while what remains still
 * covers `keepSamples`. Retention therefore sits in
 * `[keepSamples, keepSamples + oldest frame)` — at least the request, and
 * bounded by one frame above it.
 */
export function pushRing(ring: Ring, frame: Float32Array, keepSamples: number) {
  ring.frames.push(frame);
  ring.samples += frame.length;
  while (ring.frames.length > 1 && ring.samples - ring.frames[0].length >= keepSamples) {
    const gone = ring.frames.shift();
    ring.samples -= gone ? gone.length : 0;
  }
}

export function clearRing(ring: Ring) {
  ring.frames = [];
  ring.samples = 0;
}
