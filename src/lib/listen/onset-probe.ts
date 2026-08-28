/**
 * Dev-only instrumentation for the audio path, used to find where the opening
 * words of an utterance are lost.
 *
 * Inert unless a harness sets `window.__GROUND_PROBE__ = true` before the app
 * boots, so nothing here runs — or retains a single audio sample — in a real
 * meeting. This is a diagnostic, never a recorder: the buffers it keeps live in
 * memory for the page's lifetime only, and only when explicitly switched on.
 */

type ProbeEvent = {
  /** Milliseconds since the probe was armed, so timelines are readable. */
  t: number;
  lane: string;
  kind: string;
  detail?: Record<string, unknown>;
};

type ProbeClip = {
  t: number;
  lane: string;
  /** Duration of the audio actually handed to the recognizer. */
  ms: number;
  samples: number;
  sampleRate: number;
  /** Frames buffered vs frames sent — a gap means the front was trimmed. */
  bufferedMs: number;
  droppedFrontMs: number;
  /** Per-20ms RMS, so onset presence is measurable without listening. */
  envelope: number[];
  /** Quiet lead-in before the first bin above the gate. */
  leadingSilenceMs: number;
  gate: number;
  reason: string;
  wav?: string;
};

const MAX_CLIPS = 40;
const MAX_WAVS = 12;

let armedAt = 0;
let events: ProbeEvent[] = [];
let clips: ProbeClip[] = [];
let wavCount = 0;

declare global {
  interface Window {
    __GROUND_PROBE__?: boolean;
    /** Skips envelope and WAV work, which run on the audio callback's thread. */
    __GROUND_PROBE_LIGHT__?: boolean;
    __groundProbe?: {
      events: () => ProbeEvent[];
      clips: () => ProbeClip[];
      reset: () => void;
    };
  }
}

export function probeOn(): boolean {
  return typeof window !== "undefined" && window.__GROUND_PROBE__ === true;
}

function arm() {
  if (armedAt) return;
  armedAt = Date.now();
  window.__groundProbe = {
    events: () => events,
    clips: () => clips,
    reset: () => {
      events = [];
      clips = [];
      wavCount = 0;
      armedAt = Date.now();
    },
  };
}

export function mark(kind: string, lane: string, detail?: Record<string, unknown>) {
  if (!probeOn()) return;
  arm();
  events.push({ t: Date.now() - armedAt, lane, kind, detail });
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    binary += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(binary);
}

function rmsOf(samples: Float32Array, from: number, to: number): number {
  let sum = 0;
  let n = 0;
  for (let i = from; i < to && i < samples.length; i += 1) {
    sum += samples[i] * samples[i];
    n += 1;
  }
  return Math.sqrt(sum / Math.max(n, 1));
}

/**
 * Records the exact audio a recognizer is about to see. `bufferedMs` is what the
 * lane had accumulated, so a shortfall against `ms` proves the front was cut
 * before transcription rather than misheard by it.
 */
export function markClip(
  lane: string,
  samples: Float32Array,
  sampleRate: number,
  info: { bufferedMs: number; gate: number; reason: string; wav?: () => Uint8Array },
) {
  if (!probeOn()) return;
  arm();
  const ms = (samples.length / sampleRate) * 1000;
  // Envelope and WAV are the expensive part, and this runs on the same thread as
  // the audio callback. Light mode leaves timing undisturbed for final numbers.
  const light = window.__GROUND_PROBE_LIGHT__ === true;
  const bin = Math.max(1, Math.floor(sampleRate * 0.02));
  const envelope: number[] = [];
  if (!light) {
    for (let i = 0; i < samples.length; i += bin) {
      envelope.push(Number(rmsOf(samples, i, i + bin).toFixed(5)));
    }
  }
  const firstLoud = envelope.findIndex((v) => v >= info.gate);
  clips.push({
    t: Date.now() - armedAt,
    lane,
    ms: Math.round(ms),
    samples: samples.length,
    sampleRate,
    bufferedMs: Math.round(info.bufferedMs),
    droppedFrontMs: Math.max(0, Math.round(info.bufferedMs - ms)),
    envelope,
    leadingSilenceMs: firstLoud < 0 ? Math.round(ms) : firstLoud * 20,
    gate: Number(info.gate.toFixed(5)),
    reason: info.reason,
    // Only the first few clips keep audio, so a long session cannot grow without
    // bound even with the probe on.
    ...(!light && info.wav && wavCount < MAX_WAVS ? ((wavCount += 1), { wav: base64(info.wav()) }) : {}),
  });
  if (clips.length > MAX_CLIPS) clips = clips.slice(-MAX_CLIPS);
}
