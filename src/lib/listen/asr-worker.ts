/// <reference lib="webworker" />

/**
 * Local captions worker. Bundled by Vite (unlike the old CDN-imported
 * public/meethint-asr-worker.js), so it always works offline and uses the
 * same installed @huggingface/transformers the rest of the app does.
 */

type PcmJob = { type: "pcm"; id: number; final?: boolean; buffer: ArrayBuffer };
type BootMsg = { type: "boot" };

type Transcriber = (pcm: Float32Array, opts?: Record<string, unknown>) => Promise<unknown>;

let transcriber: Transcriber | null = null;
/**
 * Two classes of work. A preview is disposable — a newer one replaces it, so the
 * live caption never falls behind. A final is the line that gets committed to the
 * transcript, so it is queued and always answered.
 */
const finals: PcmJob[] = [];
let preview: PcmJob | null = null;
let inferring = false;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tune(env: any) {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
    // transformers.js defaults to cdn.jsdelivr.net for the ONNX Runtime engine,
    // which the CSP blocks on purpose. The same files are copied to /vad/ for
    // the Silero VAD (vite.config.ts vadAssetsPlugin), so load them from there.
    env.backends.onnx.wasm.wasmPaths = `${self.location.origin}/vad/`;
  }
}

async function loadModel(
  pipeline: (task: string, id: string, opts?: Record<string, unknown>) => Promise<Transcriber>,
) {
  // Xenova/distil-whisper-small.en no longer resolves (401), so every boot
  // paid a failed round trip before falling back to tiny.en.
  const ids = ["Xenova/whisper-tiny.en"];
  let last: unknown = null;
  for (const id of ids) {
    try {
      return await pipeline("automatic-speech-recognition", id, {
        progress_callback: (data: unknown) => {
          self.postMessage({ type: "progress", data });
        },
      });
    } catch (err) {
      last = err;
    }
  }
  throw last ?? new Error("captions failed");
}

async function boot() {
  const { env, pipeline } = await import("@huggingface/transformers");
  tune(env);
  transcriber = await loadModel(pipeline as never);
  // The first decode compiles the graph and is several times slower than the
  // rest. Pay that on a second of silence now, so the first spoken line does
  // not run past the caption timeout and get dropped.
  try {
    await transcriber(new Float32Array(16_000), { return_timestamps: false });
  } catch {
    /* warm-up is best effort */
  }
}

async function decode(pcm: Float32Array) {
  const opts = {
    return_timestamps: false,
    temperature: 0,
    no_repeat_ngram_size: 3,
    no_speech_threshold: 0.45,
    logprob_threshold: -0.8,
    compression_ratio_threshold: 2.2,
  };
  try {
    return await transcriber!(pcm, opts);
  } catch {
    return await transcriber!(pcm, { return_timestamps: false });
  }
}

function nextJob(): PcmJob | null {
  if (finals.length > 0) return finals.shift()!;
  const job = preview;
  preview = null;
  return job;
}

async function drain() {
  while (finals.length > 0 || preview) {
    const job = nextJob();
    if (!job) break;
    inferring = true;
    try {
      if (!transcriber) throw new Error("not ready");
      const pcm = new Float32Array(job.buffer);
      const out = (await decode(pcm)) as { text?: string } | Array<{ text?: string }>;
      // Always answer the job that finished. Dropping the result here left the
      // caller waiting out its whole timeout for work already done.
      const text = (Array.isArray(out) ? out[0]?.text : out?.text) ?? "";
      self.postMessage({ type: "text", id: job.id, text: String(text) });
    } catch (err) {
      self.postMessage({
        type: "error",
        id: job.id,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inferring = false;
    }
  }
}

self.onmessage = async (event: MessageEvent) => {
  const msg = (event.data ?? {}) as BootMsg | PcmJob;
  try {
    if (msg.type === "boot") {
      await boot();
      self.postMessage({ type: "ready" });
      return;
    }
    if (msg.type === "pcm") {
      if (msg.final) {
        finals.push(msg);
      } else {
        // Superseded before it ever ran: resolve it now instead of letting the
        // caller block until its timeout.
        if (preview) self.postMessage({ type: "text", id: preview.id, text: "" });
        preview = msg;
      }
      if (!inferring) void drain();
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      id: (msg as PcmJob).id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

export {};
