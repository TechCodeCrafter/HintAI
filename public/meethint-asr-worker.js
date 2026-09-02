let transcriber = null;
/**
 * Two classes of work. A preview is disposable — a newer one replaces it, so the
 * live caption never falls behind. A final is the line that gets committed to the
 * transcript, so it is queued and always answered.
 */
let finals = [];
let preview = null;
let inferring = false;

function tune(env) {
  env.allowLocalModels = false;
  env.allowRemoteModels = true;
  env.useBrowserCache = true;
  if (env.backends?.onnx?.wasm) {
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
  }
}

async function loadModel(pipeline) {
  const ids = ["Xenova/distil-whisper-small.en", "Xenova/whisper-tiny.en"];
  let last = null;
  for (const id of ids) {
    try {
      return await pipeline("automatic-speech-recognition", id, {
        progress_callback: (data) => {
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
  const { env, pipeline } = await import("https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.2/+esm");
  tune(env);
  transcriber = await loadModel(pipeline);
}

async function decode(pcm) {
  const opts = {
    return_timestamps: false,
    temperature: 0,
    no_repeat_ngram_size: 3,
    no_speech_threshold: 0.45,
    logprob_threshold: -0.8,
    compression_ratio_threshold: 2.2,
  };
  try {
    return await transcriber(pcm, opts);
  } catch {
    return await transcriber(pcm, { return_timestamps: false });
  }
}

function nextJob() {
  if (finals.length > 0) return finals.shift();
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
      const out = await decode(pcm);
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

self.onmessage = async (event) => {
  const msg = event.data ?? {};
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
      id: msg.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};
