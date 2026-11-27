/// <reference lib="webworker" />

/**
 * The embedding model, off the page's thread.
 *
 * Encoding a chunk takes about a fifth of a second and a folder has
 * thousands. On the page that is minutes of frozen screen, in pieces of two
 * to three seconds, and a question asked meanwhile waits behind them. Here it
 * only uses a core.
 *
 * Bundled by Vite, so the transformers runtime is same-origin. The model's
 * weights come from huggingface.co the first time and from the browser cache
 * after that. Nothing is sent anywhere: texts come in from the page and
 * vectors go back to it.
 */
import type { EmbedReply, EmbedRequest } from "./embed-queue.ts";

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

type FeaturePipe = (
  text: string | string[],
  options: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: ArrayLike<number> }>;

let loading: Promise<FeaturePipe> | null = null;

function load(): Promise<FeaturePipe> {
  loading ??= (async () => {
    const { pipeline, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    env.allowRemoteModels = true;
    env.useBrowserCache = true;
    const wasm = env.backends?.onnx?.wasm;
    if (wasm) {
      wasm.numThreads = 1;
      wasm.proxy = false;
      // transformers.js defaults to cdn.jsdelivr.net for the ONNX Runtime
      // engine, which the Content-Security-Policy blocks on purpose. The same
      // files are served at /vad/ (vite.config.ts vadAssetsPlugin).
      wasm.wasmPaths = `${self.location.origin}/vad/`;
    }
    return (await pipeline("feature-extraction", MODEL_NAME)) as unknown as FeaturePipe;
  })();
  // A failed load is not kept: the next request tries again (back online, say).
  loading.catch(() => {
    loading = null;
  });
  return loading;
}

async function encode(texts: string[]): Promise<{ dim: number; data: Float32Array }> {
  const pipe = await load();
  const options = { pooling: "mean", normalize: true } as const;
  if (texts.length > 1) {
    try {
      const all = (await pipe(texts, options)).data;
      if (all.length > 0 && all.length % texts.length === 0) {
        return { dim: all.length / texts.length, data: Float32Array.from(all) };
      }
    } catch {
      // Some builds reject a list. One at a time gives the same vectors.
    }
  }
  const rows: ArrayLike<number>[] = [];
  for (const text of texts) rows.push((await pipe(text, options)).data);
  const dim = rows[0]?.length ?? 0;
  const data = new Float32Array(dim * rows.length);
  rows.forEach((row, index) => data.set(row, index * dim));
  return { dim, data };
}

self.onmessage = (event: MessageEvent<EmbedRequest>) => {
  const request = event.data;
  if (request?.type !== "embed") return;
  void encode(request.texts).then(
    ({ dim, data }) => {
      const reply: EmbedReply = { type: "result", id: request.id, dim, data };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply, [data.buffer]);
    },
    (error: unknown) => {
      const reply: EmbedReply = {
        type: "error",
        id: request.id,
        message: error instanceof Error ? error.message : "The embedding model could not be loaded.",
      };
      (self as unknown as DedicatedWorkerGlobalScope).postMessage(reply);
    },
  );
};
