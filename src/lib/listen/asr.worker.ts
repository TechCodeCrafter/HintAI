/**
 * On-device Whisper caption worker.
 *
 * Bundled by Vite as a module worker (see local-asr.ts), so the transformers
 * runtime ships same-origin. The previous incarnation was a static file in
 * public/ that imported @xenova/transformers from the jsdelivr CDN — the app
 * CSP deliberately omits jsdelivr (scripts/security-headers.mjs, and the
 * domain-reputation tests assert its absence), so that worker could never boot.
 *
 * Two same-origin details:
 * - ORT wasm binaries are not bundled: transformers v4 defaults
 *   env.backends.onnx.wasm.wasmPaths to the jsdelivr CDN, so tune() pins it to
 *   /ort-dist/, which vite.config.ts copies from node_modules/onnxruntime-web
 *   at dev/build time (mirrors the /vad/ assets for MicVAD).
 * - Model weights still download from huggingface.co at runtime — already in
 *   the app CSP connect-src.
 */
import { env, pipeline } from "@huggingface/transformers";

type Transcriber = Awaited<ReturnType<typeof pipeline>>;
type JobMessage = { type: "pcm"; id: number; final: boolean; buffer: ArrayBuffer };

let transcriber: Transcriber | null = null;

/**
 * Two classes of work. A preview is disposable — a newer one replaces it, so the
 * live caption never falls behind. A final is the line that gets committed to the
 * transcript, so it is queued and always answered.
 */
const finals: JobMessage[] = [];
let preview: JobMessage | null = null;
let inferring = false;

function tune(): void {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  const wasm = env.backends?.onnx?.wasm;
  if (wasm) {
    wasm.numThreads = 1;
    wasm.proxy = false;
    // Same-origin ORT wasm. The v4 default is a jsdelivr CDN prefix, which the
    // app CSP blocks; /ort-dist/ is populated by the asrAssetsPlugin in
    // vite.config.ts.
    wasm.wasmPaths = "/ort-dist/";
  }
}

async function loadModel(): Promise<Transcriber> {
  const ids = ["Xenova/distil-whisper-small.en", "Xenova/whisper-tiny.en"];
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
  throw last instanceof Error ? last : new Error("captions failed");
}

async function boot(): Promise<void> {
  tune();
  transcriber = await loadModel();
}

async function decode(pcm: Float32Array): Promise<string> {
  if (!transcriber) throw new Error("not ready");
  const opts = {
    return_timestamps: false,
    temperature: 0,
    no_repeat_ngram_size: 3,
    no_speech_threshold: 0.45,
    logprob_threshold: -0.8,
    compression_ratio_threshold: 2.2,
  };
  let out: unknown;
  try {
    out = await (transcriber as (pcm: Float32Array, opts: object) => Promise<unknown>)(pcm, opts);
  } catch {
    out = await (transcriber as (pcm: Float32Array, opts: object) => Promise<unknown>)(pcm, {
      return_timestamps: false,
    });
  }
  const text = (Array.isArray(out) ? (out[0] as { text?: unknown })?.text : (out as { text?: unknown })?.text) ?? "";
  return String(text);
}

function nextJob(): JobMessage | null {
  if (finals.length > 0) return finals.shift() ?? null;
  const job = preview;
  preview = null;
  return job;
}

async function drain(): Promise<void> {
  while (finals.length > 0 || preview) {
    const job = nextJob();
    if (!job) break;
    inferring = true;
    try {
      const pcm = new Float32Array(job.buffer);
      const text = await decode(pcm);
      // Always answer the job that finished. Dropping the result here left the
      // caller waiting out its whole timeout for work already done.
      self.postMessage({ type: "text", id: job.id, text });
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
  const msg = (event.data ?? {}) as { type?: string; id?: number; final?: boolean; buffer?: ArrayBuffer };
  try {
    if (msg.type === "boot") {
      await boot();
      self.postMessage({ type: "ready" });
      return;
    }
    if (msg.type === "pcm") {
      const job: JobMessage = {
        type: "pcm",
        id: msg.id ?? 0,
        final: Boolean(msg.final),
        buffer: msg.buffer ?? new ArrayBuffer(0),
      };
      if (job.final) {
        finals.push(job);
      } else {
        // Superseded before it ever ran: resolve it now instead of letting the
        // caller block until its timeout.
        if (preview) self.postMessage({ type: "text", id: preview.id, text: "" });
        preview = job;
      }
      if (!inferring) void drain();
    }
  } catch (err) {
    self.postMessage({
      type: "error",
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
