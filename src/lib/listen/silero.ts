import { SILERO_SPEECH, sileroVoiced } from "./vad.ts";

const LEGACY_FRAME = 1536;
const TARGET_RATE = 16000;

export type SileroTap = {
  /** Last Silero speech probability, or null until the model has scored a frame. */
  latest: () => number | null;
  voiced: () => boolean | null;
  push: (frame: Float32Array, sampleRate: number) => void;
  destroy: () => Promise<void>;
};

/**
 * Silero VAD fed from our PCM worklet. The model is loaded once per lane so
 * hidden state stays with that stream. Energy VAD remains the fallback until
 * the first score lands, or if load fails.
 */
export async function createSileroTap(): Promise<SileroTap> {
  let latest: number | null = null;
  let pending = new Float32Array(0);

  const { MicVAD } = await import("@ricky0123/vad-web");
  const vad = await MicVAD.new({
    startOnLoad: false,
    processorType: "AudioWorklet",
    model: "legacy",
    baseAssetPath: "/vad/",
    onnxWASMBasePath: "/vad/",
    onFrameProcessed: (probs) => {
      latest = probs.isSpeech;
    },
  });

  function take(frame: Float32Array, sampleRate: number) {
    const at16k = sampleRate === TARGET_RATE ? frame : downsample(frame, sampleRate, TARGET_RATE);
    const next = new Float32Array(pending.length + at16k.length);
    next.set(pending);
    next.set(at16k, pending.length);
    let offset = 0;
    while (offset + LEGACY_FRAME <= next.length) {
      const window = next.subarray(offset, offset + LEGACY_FRAME);
      void vad.processFrame(window.slice());
      offset += LEGACY_FRAME;
    }
    pending = next.subarray(offset);
  }

  return {
    latest: () => latest,
    voiced: () => (latest == null ? null : sileroVoiced(latest, SILERO_SPEECH)),
    push: take,
    destroy: async () => {
      pending = new Float32Array(0);
      latest = null;
      try {
        await vad.destroy();
      } catch {
        /* already torn down */
      }
    },
  };
}

function downsample(input: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.max(1, Math.floor(input.length / ratio)));
  for (let i = 0; i < out.length; i += 1) {
    out[i] = input[Math.min(input.length - 1, Math.floor(i * ratio))] ?? 0;
  }
  return out;
}
