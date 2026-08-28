/**
 * Start-of-speech detection for one lane.
 *
 * The invariant this module exists to hold:
 *
 *   A FRAME MUST NEVER PARTICIPATE IN CALCULATING THE THRESHOLD USED TO
 *   CLASSIFY THAT SAME FRAME.
 *
 * Violating it is what made questions lose their opening words. The floor was
 * updated before classification, so after digital silence — where the floor
 * collapses to zero — the first frame of speech seeded the floor with speech
 * energy and the gate became 1.8x that frame. The frame had raised its own bar
 * above itself, and the lane stayed shut until an unusually loud syllable
 * arrived, up to 1.8s into the question.
 *
 * So the order is fixed: read the floor left by earlier frames, derive the gate,
 * classify, and only then let a frame already judged non-speech inform the floor
 * for future frames. Continuation is not this module's business; the hangover in
 * the caller owns it.
 */

/** How far above the measured quiet level speech has to sit to count. */
export const FLOOR_MULTIPLIER = 1.8;
/** The floor is a decaying minimum, allowed to creep up slowly. */
const FLOOR_CREEP = 1.02;
const FLOOR_CREEP_FLOOR = 0.00002;

export type VadLane = {
  /** Static base threshold for this lane. */
  vad: number;
  /** Quiet level estimated from earlier non-speech frames. Zero when unknown. */
  floor: number;
  mode: "idle" | "active";
};

/**
 * The bar the next frame must clear. With an unknown (zero) floor this is simply
 * the lane's base threshold, which is why zero needs no special handling —
 * silence never has to be nudged into a non-zero estimate.
 */
export function gateFor(lane: Pick<VadLane, "vad" | "floor">): number {
  return Math.max(lane.vad, lane.floor * FLOOR_MULTIPLIER);
}

/**
 * Folds a non-speech level into the floor, for use by later frames only. Callers
 * must classify first; this is never safe to call with a voiced frame.
 */
export function trackFloor(lane: Pick<VadLane, "floor">, level: number) {
  lane.floor = lane.floor <= 0 ? level : Math.min(level, lane.floor * FLOOR_CREEP + FLOOR_CREEP_FLOOR);
}

export type VadFrameResult = {
  /** The gate applied to this frame, derived only from earlier frames. */
  gate: number;
  voiced: boolean;
  /** The floor as it stood when this frame was classified. */
  floorBefore: number;
};

/**
 * Classifies one frame and updates lane floor state for the frames after it.
 *
 * The lane's mode must still be the mode it had when the frame arrived — the
 * caller applies any transition afterwards — so the frame that opens a lane is
 * read as idle-and-voiced and therefore never touches the floor.
 */
export function observeFrame(lane: VadLane, level: number): VadFrameResult {
  const floorBefore = lane.floor;
  const gate = gateFor(lane);
  const voiced = level >= gate;
  // Only quiet frames, and only while nobody is mid-sentence: during an
  // utterance the quiet between syllables is not background.
  if (!voiced && lane.mode === "idle") trackFloor(lane, level);
  return { gate, voiced, floorBefore };
}
