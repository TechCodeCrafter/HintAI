import { transcribeAvailable, transcribeClip } from "@/lib/ai/transcribe";
import {
  type WorkletStat,
  armCapture,
  captureMark,
  captureOn,
  captureVad,
  recordWorklet,
  tickFrame,
} from "@/lib/listen/capture-probe";
import { transcribeLocal, warmupAsr } from "@/lib/listen/local-asr";
import {
  type Ring,
  clearRing,
  keepSamplesFor,
  newRing,
  pushRing,
  ringMs,
} from "@/lib/listen/ring";
import { gateFor, observeFrame } from "@/lib/listen/vad";
import { mark, markClip, probeOn } from "@/lib/listen/onset-probe";
import { encodeWavFromStreamChunk, pcm16kFromFrames, wavBytesMono } from "@/lib/listen/wav";
import { cleanCaption } from "@/lib/search/question";
import { useGround } from "@/lib/store";

const FIRST_MS = 1400;
/** Only the live draft reads a trailing window; a committed clip is never trimmed. */
const PREVIEW_WINDOW_MS = 4000;
/**
 * A lane must hand over a line even if the level never drops — a real room has
 * a constant noise floor, so waiting for silence can wait forever.
 */
const MAX_UTTER_MS = 7000;

/**
 * Segmentation is measured, not guessed, so the harness can sweep these.
 *
 * `preRollMs` is how much audio before the detection frame joins the clip: a
 * word's opening consonant is quieter than the gate, so without it the first
 * syllable is discarded. `hangoverMs` is the sustained quiet needed to end an
 * utterance — a normal pause inside a sentence is shorter than this, so the
 * question survives as one segment.
 */
export type SegmentTuning = {
  preRollMs: number;
  hangoverMs: number;
  /** Speech stays active down to this fraction of the start gate. */
  stopRatio: number;
  /** Voiced audio needed to be a line of its own — not wall-clock duration. */
  minVoicedMs: number;
  /** Voiced audio below which a fragment is held for merging rather than sent. */
  mergeFloorMs: number;
  /** How long a held fragment waits to join the next utterance. */
  mergeGapMs: number;
};

const DEFAULT_TUNING: SegmentTuning = {
  preRollMs: 500,
  hangoverMs: 900,
  stopRatio: 0.55,
  minVoicedMs: 400,
  mergeFloorMs: 150,
  mergeGapMs: 1200,
};

let tuning: SegmentTuning = { ...DEFAULT_TUNING };

export function configureSegmentation(next: Partial<SegmentTuning>) {
  tuning = { ...tuning, ...next };
}

export function segmentTuning(): SegmentTuning {
  return tuning;
}

type LaneName = "mic" | "computer";
type LaneMode = "idle" | "active";

type Lane = {
  name: LaneName;
  mode: LaneMode;
  /** Bounded ring of the most recent audio, filled in every state. */
  roll: Ring;
  /** The utterance in progress: pre-roll first, then speech. */
  pending: Float32Array[];
  /** Frames of pending that precede the detection frame. */
  rollLead: number;
  startedAt: number;
  silenceAt: number;
  vad: number;
  /** Running estimate of this lane's quiet level. */
  floor: number;
  skip: () => boolean;
  /** A sub-minimum segment held back to join the next one, never discarded blindly. */
  carry: Float32Array[];
  carryMs: number;
  carryAt: number;
};

let held: MediaStream[] = [];
let audioCtx: AudioContext | null = null;
let processors: ScriptProcessorNode[] = [];
let sources: MediaStreamAudioSourceNode[] = [];
let sampleRate = 16000;
let running = false;
let hasComputer = false;
let useXai = false;
let lastLevelAt = 0;
let latestJob: { frames: Float32Array[]; lane: LaneName; vad: number } | null = null;
let pumping = false;
let pumpSeq = 0;
let speechLiveAt = 0;
let draftFrom: LaneName | null = null;
/**
 * Identity for committed clips. Minted at the commit boundary and carried all the
 * way to the transcript, so two clips that transcribe to the same words are still
 * two events. Never derived from the audio or the text.
 */
let commitSeq = 0;

export function markSpeechLive() {
  speechLiveAt = Date.now();
}

function speechHeardRecently(ms = 1200): boolean {
  return speechLiveAt > 0 && Date.now() - speechLiveAt < ms;
}

function stopGraph() {
  for (const node of processors) {
    try {
      node.disconnect();
    } catch {
      /* ignore */
    }
  }
  processors = [];
  for (const src of sources) {
    try {
      src.disconnect();
    } catch {
      /* ignore */
    }
  }
  sources = [];
  void audioCtx?.close();
  audioCtx = null;
}

function release() {
  running = false;
  hasComputer = false;
  useXai = false;
  latestJob = null;
  pumping = false;
  pumpSeq += 1;
  speechLiveAt = 0;
  draftFrom = null;
  useGround.getState().setHearLevel(0);
  useGround.getState().setLiveDraft("");
  useGround.getState().setAsrStatus("off");
  held.forEach((stream) => {
    stream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* ignore */
      }
    });
  });
  held = [];
  stopGraph();
}

function rms(frame: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < frame.length; i += 1) sum += frame[i] * frame[i];
  return Math.sqrt(sum / Math.max(frame.length, 1));
}

function clipRms(frames: Float32Array[]): number {
  let sum = 0;
  let n = 0;
  for (const frame of frames) {
    for (let i = 0; i < frame.length; i += 1) {
      sum += frame[i] * frame[i];
      n += 1;
    }
  }
  return Math.sqrt(sum / Math.max(n, 1));
}

function voicedRatio(frames: Float32Array[], gate: number): number {
  let voiced = 0;
  for (const frame of frames) {
    if (rms(frame) >= gate) voiced += 1;
  }
  return voiced / Math.max(frames.length, 1);
}

function clipHasSpeech(frames: Float32Array[], gate: number): boolean {
  if (frames.length < 6) return false;
  if (clipRms(frames) < gate) return false;
  return voicedRatio(frames, gate) >= 0.4;
}

/**
 * How much of the clip is actually voiced. Unlike a ratio this is unaffected by
 * how much silence sits in front, which matters now that every clip opens with
 * pre-roll.
 */
function voicedMs(frames: Float32Array[], gate: number): number {
  let voiced = 0;
  for (const frame of frames) {
    if (rms(frame) >= gate) voiced += frame.length;
  }
  return (voiced / sampleRate) * 1000;
}

/**
 * Which side of the conversation a lane represents. The shared tab is always the
 * other person. The microphone is you — unless it is the only ear GROUND has, in
 * which case it has to carry the room or nothing would ever be answered.
 */
export function roleForLane(lane: LaneName): "them" | "you" {
  if (lane === "computer") return "them";
  return hasComputer ? "you" : "them";
}

export function micCarriesRoom(): boolean {
  return !hasComputer;
}

function ingestHeard(text: string, lane: LaneName, eventId: string) {
  const cleaned = cleanCaption(text);
  if (!cleaned) return;
  const state = useGround.getState();
  draftFrom = null;
  state.heard({ id: eventId, role: roleForLane(lane), text: cleaned });
  mark("committed", lane, { text: cleaned, role: roleForLane(lane), eventId });
}

function frameMs(frame: Float32Array): number {
  return (frame.length / sampleRate) * 1000;
}

function totalMs(frames: Float32Array[]): number {
  let n = 0;
  for (const frame of frames) n += frame.length;
  return (n / sampleRate) * 1000;
}

/**
 * Keeps at least the last `preRollMs` of audio for this lane. Filled in every
 * state so that when speech is finally detected the clip can start before the
 * detection frame rather than at it.
 */
function pushRoll(lane: Lane, frame: Float32Array) {
  pushRing(lane.roll, frame, keepSamplesFor(tuning.preRollMs, sampleRate));
}

/** How much audio the lane currently has in hand. */
function rollMsOf(lane: Lane): number {
  return ringMs(lane.roll, sampleRate);
}

/**
 * IDLE → ACTIVE. The clip opens with the pre-roll already in hand, plus any
 * fragment held back from a sentence that was cut short a moment ago. The
 * detection frame is taken from the roll, so it is never added twice.
 */
function openLane(lane: Lane, now: number) {
  lane.mode = "active";
  lane.pending = lane.roll.frames.slice();
  let mergedMs = 0;
  if (lane.carry.length && now - lane.carryAt <= tuning.mergeGapMs) {
    lane.pending = lane.carry.concat(lane.pending);
    mergedMs = lane.carryMs;
  } else if (lane.carry.length) {
    mark("fragment-expired", lane.name, { heldMs: Math.round(lane.carryMs) });
  }
  lane.rollLead = lane.pending.length;
  lane.carry = [];
  lane.carryMs = 0;
  // Merged speech counts toward the minimum, so the pair is judged as one line.
  lane.startedAt = now - mergedMs;
  lane.silenceAt = now;
  mark("vad-open", lane.name, {
    gate: Number(gateFor(lane).toFixed(5)),
    preRollMs: Math.round(rollMsOf(lane)),
    requestedPreRollMs: tuning.preRollMs,
    mergedMs: Math.round(mergedMs),
  });
}

function windowFrames(frames: Float32Array[], ms: number): Float32Array[] {
  const need = Math.max(1, Math.floor((ms / 1000) * sampleRate));
  const out: Float32Array[] = [];
  let n = 0;
  for (let i = frames.length - 1; i >= 0 && n < need; i -= 1) {
    out.unshift(frames[i] ?? new Float32Array(0));
    n += frames[i]?.length ?? 0;
  }
  return out;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < buf.length; i += step) {
    binary += String.fromCharCode(...buf.subarray(i, i + step));
  }
  return btoa(binary);
}

/** `lane` and `bufferedMs` are diagnostics only; transcription ignores them. */
async function captionAccurate(
  frames: Float32Array[],
  probe?: { lane: LaneName; bufferedMs: number; gate: number },
): Promise<string> {
  if (probe && probeOn()) {
    markClip(probe.lane, pcm16kFromFrames(frames, sampleRate), 16000, {
      bufferedMs: probe.bufferedMs,
      gate: probe.gate,
      reason: "final",
      wav: () => wavBytesMono(pcm16kFromFrames(frames, sampleRate), 16000),
    });
  }
  if (useXai) {
    try {
      const blob = encodeWavFromStreamChunk(frames, sampleRate);
      const audio = await blobToBase64(blob);
      const result = await transcribeClip({ data: { audio, mime: "audio/wav" } });
      if (result.ok) return cleanCaption(result.text);
    } catch {
      /* local fallback */
    }
  }
  mark("whisper-start", probe?.lane ?? "?", { path: "local" });
  const raw = await transcribeLocal(pcm16kFromFrames(frames, sampleRate), 9000, undefined, true);
  mark("whisper-done", probe?.lane ?? "?", { raw });
  const cleaned = cleanCaption(raw);
  mark("clean-caption", probe?.lane ?? "?", { raw, cleaned });
  return cleaned;
}

/**
 * Speech has to clear the room's own noise, not just a fixed threshold. A steady
 * tone parks the level above `vad` forever, which used to hold the lane open and
 * stop anything from ever being committed.
 */
function requestPreview(lane: Lane) {
  if (lane.mode !== "active" || lane.skip()) return;
  if (Date.now() - lane.startedAt < FIRST_MS) return;
  const frames = windowFrames(lane.pending, PREVIEW_WINDOW_MS);
  const gate = gateFor(lane);
  if (!clipHasSpeech(frames, gate)) return;
  latestJob = { frames, lane: lane.name, vad: gate };
  void pump();
}

async function pump() {
  if (pumping) return;
  pumping = true;
  while (running && latestJob) {
    const job = latestJob;
    latestJob = null;
    const seq = (pumpSeq += 1);
    try {
      if (!clipHasSpeech(job.frames, job.vad)) continue;
      const text = cleanCaption(await transcribeLocal(pcm16kFromFrames(job.frames, sampleRate), 7000));
      if (!running || seq !== pumpSeq) continue;
      if (!text || speechHeardRecently()) continue;
      draftFrom = job.lane;
      useGround.getState().setLiveDraft(text, roleForLane(job.lane));
    } catch {
      /* keep streaming */
    }
  }
  pumping = false;
}

/**
 * ACTIVE → COMMIT → RESET, and nothing here may block: this runs inside the
 * audio callback, so the lane's state is settled synchronously and the actual
 * transcription is handed to a later task. Resampling an eight-second clip on
 * this thread is what starved the next utterance of frames.
 *
 * `forced` means the level never dropped, so the lane stays open and starts a
 * fresh segment rather than going idle mid-sentence.
 */
function closeLane(lane: Lane, forced = false) {
  const now = Date.now();
  const spokeMs = now - lane.startedAt;
  // The whole utterance goes to the recognizer. Trimming to a trailing window
  // would discard the pre-roll this fix exists to capture.
  const frames = lane.pending;
  const bufferedMs = totalMs(frames);
  const gate = gateFor(lane);
  const name = lane.name;
  // Judged on how much voiced audio the clip holds, across the whole clip.
  // Wall-clock since detection is not evidence: when detection is late the
  // speech sits in the pre-roll, and measuring from the detection frame threw
  // away exactly the questions this fix is meant to save.
  const voiced = voicedMs(frames, gate);

  mark("utterance-end", name, {
    forced,
    spokeMs,
    voicedMs: Math.round(voiced),
    bufferedMs: Math.round(bufferedMs),
    sentMs: Math.round(bufferedMs),
    preRollMs: Math.round(totalMs(frames.slice(0, lane.rollLead))),
    hangoverMs: tuning.hangoverMs,
    minVoicedMs: tuning.minVoicedMs,
  });
  // Places the clip Whisper will see on the audio timeline, so its first frame
  // can be compared against where the question actually started.
  captureMark("clip-committed", name, {
    clipMs: Math.round(bufferedMs),
    preRollMs: Math.round(totalMs(frames.slice(0, lane.rollLead))),
    voicedMs: Math.round(voiced),
    frames: frames.length,
  });

  lane.pending = [];
  lane.rollLead = 0;
  // Pre-roll must never cross a commit boundary, or the next question would
  // open with the tail of this one and Whisper would hear both.
  clearRing(lane.roll);
  if (forced) {
    lane.startedAt = now;
    lane.silenceAt = now;
  } else {
    lane.mode = "idle";
  }

  const enough = voiced >= tuning.minVoicedMs;
  if (!enough) {
    // Short is not the same as junk: if it carried any speech at all, hold it
    // so it can join whatever comes next instead of vanishing.
    if (voiced >= tuning.mergeFloorMs && frames.length) {
      lane.carry = frames;
      lane.carryMs = voiced;
      lane.carryAt = now;
      mark("fragment-held", name, { voicedMs: Math.round(voiced), ms: Math.round(bufferedMs) });
    } else {
      lane.carry = [];
      lane.carryMs = 0;
      mark("utterance-dropped", name, { spokeMs, voicedMs: Math.round(voiced), noSpeech: true });
    }
  }

  mark("lane-reset", name, {
    mode: lane.mode,
    pendingFrames: lane.pending.length,
    rollMs: Math.round(rollMsOf(lane)),
    carryFrames: lane.carry.length,
  });

  if (draftFrom && draftFrom !== name) return;
  latestJob = null;
  pumpSeq += 1;
  if (!enough) {
    if (draftFrom === name) {
      useGround.getState().setLiveDraft("");
      draftFrom = null;
    }
    return;
  }
  // The clip's identity is fixed here, at the commit, not after transcription —
  // decoding is async and two clips can be in flight at once.
  commitSeq += 1;
  const eventId = `${name}-${commitSeq}`;
  // Off the audio callback, so frames keep arriving while this clip decodes.
  setTimeout(() => void transcribeSegment(frames, name, bufferedMs, gate, eventId), 0);
}

async function transcribeSegment(
  frames: Float32Array[],
  name: LaneName,
  bufferedMs: number,
  gate: number,
  eventId: string,
) {
  try {
    const text = await captionAccurate(frames, { lane: name, bufferedMs, gate });
    if (!running) return;
    if (text) ingestHeard(text, name, eventId);
    else if (draftFrom === name) {
      useGround.getState().setLiveDraft("");
      draftFrom = null;
    }
  } catch {
    /* keep hearing */
  }
}

function attachLane(processor: ScriptProcessorNode, lane: Lane) {
  let sawFirstFrame = false;
  processor.onaudioprocess = (event) => {
    if (!running) return;
    const frame = event.inputBuffer.getChannelData(0);
    // First thing in the callback, before any work of ours could distort it.
    tickFrame(lane.name, event.playbackTime, frame.length);
    const copy = new Float32Array(frame);
    if (!sawFirstFrame) {
      sawFirstFrame = true;
      mark("pcm-first-frame", lane.name, { sampleRate, frameSamples: copy.length });
      captureMark("pcm-first-frame", lane.name, { playbackTime: event.playbackTime });
    }
    const level = rms(copy);
    const now = Date.now();
    if (now - lastLevelAt > 80) {
      lastLevelAt = now;
      useGround.getState().setHearLevel(Math.min(1, level * 10));
    }
    if (lane.skip()) return;
    // Classified against the floor left by earlier frames, and only allowed to
    // inform the floor afterwards. Reversing these two steps is what let a
    // question's first frame raise the bar above itself.
    const { gate: startGate, voiced, floorBefore } = observeFrame(lane, level);
    if (probeOn()) {
      // Every frame, so the pre-VAD run-up to an onset is measurable.
      mark("frame", lane.name, {
        level: Number(level.toFixed(5)),
        gate: Number(startGate.toFixed(5)),
        floor: Number(floorBefore.toFixed(5)),
        mode: lane.mode,
        frameMs: Math.round(frameMs(copy)),
      });
    }
    // The VAD decision itself, frame by frame: the energy, the bar it had to
    // clear, and the state it was in. This is what shows whether a late open was
    // a threshold that speech never reached or a transition that never fired.
    captureVad(lane.name, event.playbackTime, {
      level,
      gate: startGate,
      floor: floorBefore,
      voiced,
      mode: lane.mode,
    });
    // Audio is retained first and unconditionally, so the pre-roll is already
    // there whenever speech turns out to have started.
    pushRoll(lane, copy);

    if (lane.mode === "idle") {
      if (voiced) {
        openLane(lane, now);
        captureMark("vad-open", lane.name, {
          playbackTime: event.playbackTime,
          preRollMs: Math.round(rollMsOf(lane)),
        });
        if (!draftFrom) useGround.getState().setLiveDraft("…", roleForLane(lane.name));
      }
      return;
    }

    lane.pending.push(copy);
    // Hysteresis: once speaking, the level only has to clear a lower bar, so a
    // quiet syllable does not read as the end of the sentence.
    if (level >= startGate * tuning.stopRatio) lane.silenceAt = now;
    if (now - lane.startedAt >= MAX_UTTER_MS) {
      closeLane(lane, true);
      return;
    }
    if (now - lane.silenceAt >= tuning.hangoverMs) {
      closeLane(lane);
      return;
    }
    requestPreview(lane);
  };
}

async function openMic(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getUserMedia) return null;
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
      video: false,
    });
  } catch {
    return null;
  }
}

async function openComputer(): Promise<MediaStream | null> {
  if (!navigator.mediaDevices?.getDisplayMedia) return null;
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: true,
    });
    stream.getVideoTracks().forEach((track) => track.stop());
    const audio = stream.getAudioTracks();
    if (audio.length === 0) {
      stream.getTracks().forEach((track) => {
        track.stop();
      });
      return null;
    }
    return new MediaStream(audio);
  } catch {
    return null;
  }
}

/**
 * Attaches the shadow AudioWorklet used only to prove where PCM is lost. It
 * reads the same source node as the ScriptProcessorNode and reports counters;
 * its output is left unconnected so it contributes nothing to the graph.
 */
async function shadowMonitor(ctx: AudioContext, src: MediaStreamAudioSourceNode, lane: LaneName) {
  try {
    await ctx.audioWorklet.addModule("/ground-capture-worklet.js");
    const node = new AudioWorkletNode(ctx, "ground-capture-monitor", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      processorOptions: { lane },
    });
    node.port.onmessage = (event) => recordWorklet(event.data as WorkletStat);
    src.connect(node);
    captureMark("worklet-attached", lane);
  } catch (err) {
    captureMark("worklet-failed", lane, { error: String(err).slice(0, 120) });
  }
}

function listenTo(stream: MediaStream, lane: Lane) {
  if (!audioCtx) return;
  const src = audioCtx.createMediaStreamSource(stream);
  sources.push(src);
  const processor = audioCtx.createScriptProcessor(2048, 1, 1);
  processors.push(processor);
  attachLane(processor, lane);
  const mute = audioCtx.createGain();
  mute.gain.value = 0;
  src.connect(processor);
  processor.connect(mute);
  mute.connect(audioCtx.destination);
  // Test-only observer on the same source. Never connected to anything, so it
  // cannot affect the graph, the VAD, or a single word of the transcript.
  if (captureOn()) void shadowMonitor(audioCtx, src, lane.name);
  stream.getAudioTracks()[0]?.addEventListener("ended", () => {
    if (held.every((s) => s.getAudioTracks().every((t) => t.readyState !== "live"))) {
      stopHear();
    }
  });
}

function startGraph(mic: MediaStream | null, computer: MediaStream | null) {
  const ctx = (() => {
    try {
      return new AudioContext({ sampleRate: 16000 });
    } catch {
      return new AudioContext();
    }
  })();
  audioCtx = ctx;
  sampleRate = ctx.sampleRate;
  void ctx.resume();

  // Each lane owns its own ring buffer and its own state. Nothing is shared, so
  // the call can never contribute audio to a microphone utterance.
  const blank = (): Omit<Lane, "name" | "vad" | "skip"> => ({
    mode: "idle",
    roll: newRing(),
    pending: [],
    rollLead: 0,
    startedAt: 0,
    silenceAt: 0,
    floor: 0,
    carry: [],
    carryMs: 0,
    carryAt: 0,
  });

  if (computer) {
    listenTo(computer, { name: "computer", vad: 0.024, skip: () => false, ...blank() });
  }

  if (mic) {
    listenTo(mic, {
      name: "mic",
      vad: 0.013,
      // Browser captions already cover the mic; skip until they go quiet.
      skip: () => speechHeardRecently(),
      ...blank(),
    });
  }
}

export function isSharingCall(): boolean {
  return running;
}

export async function startHear(): Promise<void> {
  if (running) return;
  // Test-only: lets the harness sweep segmentation values without a rebuild.
  const override = (globalThis as { __GROUND_TUNING__?: Partial<SegmentTuning> }).__GROUND_TUNING__;
  if (override) configureSegmentation(override);
  armCapture();
  void warmupAsr();
  const speech = await import("@/lib/listen/speech");
  if (speech.liveCaptionsOk()) speech.startCaptions();
  const mic = await openMic();
  const computer = await openComputer();
  const streams = [mic, computer].filter((s): s is MediaStream => Boolean(s));
  if (streams.length === 0) {
    speech.stopListeningAndMic();
    throw new Error("Allow the microphone, or share a tab with audio.");
  }

  mark("tracks-active", "both", {
    mic: Boolean(mic),
    computer: Boolean(computer),
    micTracks: mic?.getAudioTracks().length ?? 0,
    computerTracks: computer?.getAudioTracks().length ?? 0,
  });
  held = streams;
  hasComputer = Boolean(computer);
  useGround.getState().clearThem();
  startGraph(mic, computer);
  running = true;
  useGround.getState().setSharingCall(true);
  useGround.getState().arm();
  useGround.getState().setListenError(null);
  useGround.getState().setAsrStatus("live");
  useGround.getState().setAsrNote("");

  const what =
    mic && computer
      ? "Call and mic are separate lanes. Questions from the shared tab become Cards."
      : computer
        ? "Hearing the call tab. Questions from it become Cards."
        : "Mic only — no shared tab, so your mic is carrying the room. Share the call tab to keep the two apart.";
  useGround.getState().appendUtterance({
    at: Date.now(),
    speaker: "GROUND",
    role: "system",
    text: what,
  });

  void transcribeAvailable()
    .then((ok) => {
      if (running) useXai = Boolean(ok);
    })
    .catch(() => {
      useXai = false;
    });
}

export async function startCallShare(): Promise<void> {
  return startHear();
}

export function stopHear() {
  release();
  void import("@/lib/listen/speech").then((speech) => speech.stopListeningAndMic());
  useGround.getState().setSharingCall(false);
}

export function stopCallShare() {
  stopHear();
}

export function toggleHear() {
  const state = useGround.getState();
  if (running || (state.armed && !state.listenError)) {
    stopHear();
    state.disarm();
    return;
  }
  void startHear().catch((err) => {
    useGround.getState().setListenError(null);
    useGround.getState().appendUtterance({
      at: Date.now(),
      speaker: "GROUND",
      role: "system",
      text: err instanceof Error ? err.message : "Could not start hearing.",
    });
  });
}
