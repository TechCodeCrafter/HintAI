/**
 * Test-only instrumentation for the capture boundary.
 *
 * The question it answers: does ScriptProcessorNode actually lose PCM when the
 * main thread stalls, or is audio missing before it ever reaches us?
 *
 * `AudioProcessingEvent.playbackTime` is on the audio clock, and consecutive
 * callbacks must advance by exactly one frame. A larger jump is therefore
 * dropped audio, provable without trusting main-thread timing at all.
 *
 * Inert unless a harness sets `window.__GROUND_CAPTURE__` before boot. The hot
 * path writes four numbers into preallocated typed arrays — no allocation, no
 * string formatting, no encoding — because anything expensive here would create
 * the very stall it is trying to measure. All analysis happens afterwards.
 */

const CAP = 8192;

let armed = false;
let count = 0;
const wallAt = new Float64Array(CAP);
const audioAt = new Float64Array(CAP);
const frameLen = new Int32Array(CAP);
const laneOf = new Int8Array(CAP);

export type CaptureMark = {
  kind: string;
  lane: string;
  wall: number;
  detail?: Record<string, number | string | boolean>;
};
let marks: CaptureMark[] = [];

/**
 * One VAD decision. Recorded per frame so a late open can be read off a timeline
 * instead of guessed at. Five numbers into typed arrays — cheap enough to sit in
 * the audio callback.
 */
const VCAP = 4096;
let vcount = 0;
const vAt = new Float64Array(VCAP);
const vLevel = new Float64Array(VCAP);
const vGate = new Float64Array(VCAP);
const vFloor = new Float64Array(VCAP);
const vFlags = new Int8Array(VCAP); // bit 0: voiced, bit 1: lane active
const vLane = new Int8Array(VCAP);
/** Where the harness last reset, so the timeline can be zeroed on playback. */
let vEpoch = 0;

export type VadFrame = {
  atMs: number;
  level: number;
  gate: number;
  floor: number;
  voiced: boolean;
  mode: "idle" | "active";
  /** How far above the floor this frame sat, as a ratio. */
  snr: number;
};

export function captureVad(
  lane: string,
  playbackTime: number,
  d: { level: number; gate: number; floor: number; voiced: boolean; mode: "idle" | "active" },
) {
  if (!armed) return;
  const i = vcount % VCAP;
  vAt[i] = playbackTime;
  vLevel[i] = d.level;
  vGate[i] = d.gate;
  vFloor[i] = d.floor;
  vFlags[i] = (d.voiced ? 1 : 0) | (d.mode === "active" ? 2 : 0);
  vLane[i] = LANE_ID[lane] ?? 0;
  vcount += 1;
}

/**
 * Frames are retained across a reset so the timeline can include the quiet
 * before speech — that run-up is where the noise floor is estimated, so a
 * timeline that begins at the first speech frame cannot show how the floor got
 * its value.
 */
function vadFrames(lane: string, id: number, lead = 8): VadFrame[] {
  const n = Math.min(vcount, VCAP);
  const mine: number[] = [];
  for (let i = 0; i < n; i += 1) if (vLane[i] === id) mine.push(i);
  const epochAt = mine.findIndex((i) => i >= vEpoch);
  const from = epochAt < 0 ? Math.max(0, mine.length - lead) : Math.max(0, epochAt - lead);
  const zero = epochAt < 0 ? mine.length - 1 : epochAt;
  const start = mine.length ? vAt[mine[Math.min(zero, mine.length - 1)]] : 0;

  const out: VadFrame[] = [];
  for (let k = from; k < mine.length; k += 1) {
    const i = mine[k];
    out.push({
      atMs: Math.round((vAt[i] - start) * 1000),
      level: vLevel[i],
      gate: vGate[i],
      floor: vFloor[i],
      voiced: (vFlags[i] & 1) === 1,
      mode: (vFlags[i] & 2) === 2 ? "active" : "idle",
      snr: vFloor[i] > 0 ? vLevel[i] / vFloor[i] : 0,
    });
  }
  return out;
}

export type WorkletStat = {
  lane: string;
  /** process() calls observed on the audio rendering thread. */
  calls: number;
  /** Sample position reported by the audio thread, so gaps are visible. */
  frames: number;
  firstTime: number;
  lastTime: number;
  maxGapMs: number;
  missingMs: number;
};
let workletStats: WorkletStat[] = [];

declare global {
  interface Window {
    __GROUND_CAPTURE__?: boolean;
    __groundCapture?: {
      report: (sampleRate: number) => CaptureReport;
      marks: () => CaptureMark[];
      worklet: () => WorkletStat[];
      reset: () => void;
    };
  }
}

export function captureOn(): boolean {
  return typeof window !== "undefined" && window.__GROUND_CAPTURE__ === true;
}

const LANE_ID: Record<string, number> = { computer: 0, mic: 1 };

/** Hot path. Called from inside the audio callback; keep it this cheap. */
export function tickFrame(lane: string, playbackTime: number, frameSamples: number) {
  if (!armed) return;
  const i = count % CAP;
  wallAt[i] = performance.now();
  audioAt[i] = playbackTime;
  frameLen[i] = frameSamples;
  laneOf[i] = LANE_ID[lane] ?? 0;
  count += 1;
}

/** Rare events only — allocation is fine here. */
export function captureMark(kind: string, lane: string, detail?: CaptureMark["detail"]) {
  if (!armed) return;
  marks.push({ kind, lane, wall: performance.now(), detail });
}

export function recordWorklet(stat: WorkletStat) {
  if (!armed) return;
  workletStats = [...workletStats.filter((s) => s.lane !== stat.lane), stat];
}

export type LaneReport = {
  lane: string;
  frames: number;
  deliveredMs: number;
  /** Span of the audio clock the callbacks covered. */
  audioSpanMs: number;
  expectedFrames: number;
  missingFrames: number;
  missingMs: number;
  /** Largest jump on the audio clock — this is lost PCM. */
  maxAudioGapMs: number;
  /** Largest wall-clock delay between callbacks — main-thread stall. */
  maxWallGapMs: number;
  frameMs: number;
  gaps: Array<{ atMs: number; audioGapMs: number; wallGapMs: number; lostMs: number }>;
};

export type CaptureReport = {
  lanes: LaneReport[];
  marks: CaptureMark[];
  worklet: WorkletStat[];
  vad: Record<string, VadFrame[]>;
};

function laneReport(lane: string, id: number, sampleRate: number): LaneReport {
  const n = Math.min(count, CAP);
  const idx: number[] = [];
  for (let i = 0; i < n; i += 1) if (laneOf[i] === id) idx.push(i);

  const frameSamples = idx.length ? frameLen[idx[0]] : 0;
  const frameMs = frameSamples ? (frameSamples / sampleRate) * 1000 : 0;
  const empty: LaneReport = {
    lane,
    frames: idx.length,
    deliveredMs: 0,
    audioSpanMs: 0,
    expectedFrames: 0,
    missingFrames: 0,
    missingMs: 0,
    maxAudioGapMs: 0,
    maxWallGapMs: 0,
    frameMs: Math.round(frameMs),
    gaps: [],
  };
  if (idx.length < 2) return empty;

  let delivered = 0;
  let maxAudioGap = 0;
  let maxWallGap = 0;
  const gaps: LaneReport["gaps"] = [];
  const start = audioAt[idx[0]];
  for (let k = 0; k < idx.length; k += 1) {
    delivered += frameLen[idx[k]];
    if (k === 0) continue;
    const audioGap = (audioAt[idx[k]] - audioAt[idx[k - 1]]) * 1000;
    const wallGap = wallAt[idx[k]] - wallAt[idx[k - 1]];
    if (audioGap > maxAudioGap) maxAudioGap = audioGap;
    if (wallGap > maxWallGap) maxWallGap = wallGap;
    // One frame of advance is normal; anything beyond it never arrived.
    const lost = audioGap - frameMs;
    if (lost > frameMs * 0.5) {
      gaps.push({
        atMs: Math.round((audioAt[idx[k]] - start) * 1000),
        audioGapMs: Math.round(audioGap),
        wallGapMs: Math.round(wallGap),
        lostMs: Math.round(lost),
      });
    }
  }

  const audioSpanMs = (audioAt[idx.at(-1) as number] - start) * 1000 + frameMs;
  const deliveredMs = (delivered / sampleRate) * 1000;
  const expectedFrames = frameMs ? Math.round(audioSpanMs / frameMs) : idx.length;
  return {
    lane,
    frames: idx.length,
    deliveredMs: Math.round(deliveredMs),
    audioSpanMs: Math.round(audioSpanMs),
    expectedFrames,
    missingFrames: Math.max(0, expectedFrames - idx.length),
    missingMs: Math.round(Math.max(0, audioSpanMs - deliveredMs)),
    maxAudioGapMs: Math.round(maxAudioGap),
    maxWallGapMs: Math.round(maxWallGap),
    frameMs: Math.round(frameMs),
    gaps,
  };
}

export function armCapture() {
  if (!captureOn() || armed) return;
  armed = true;
  window.__groundCapture = {
    report: (sampleRate: number) => ({
      lanes: [laneReport("computer", 0, sampleRate), laneReport("mic", 1, sampleRate)],
      marks,
      worklet: workletStats,
      vad: { computer: vadFrames("computer", 0), mic: vadFrames("mic", 1) },
    }),
    marks: () => marks,
    worklet: () => workletStats,
    reset: () => {
      count = 0;
      vEpoch = vcount;
      marks = [];
      workletStats = [];
    },
  };
}
