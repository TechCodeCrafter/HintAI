/**
 * Browser-side embeddings for hybrid retrieval.
 *
 * Semantic search only ranks candidate chunks. It never writes a spoken line —
 * localCard still has to extract and support every word from the material.
 *
 * The installed package is `@huggingface/transformers` (the current name for
 * what the Xenova package used to be). The MiniLM checkpoint is unchanged.
 *
 * In a browser the model runs in a worker (`embed-worker.ts`), reached
 * through a queue that puts a question ahead of the chunks being indexed
 * (`embed-queue.ts`). Where there is no worker to run it in, it is loaded
 * here, as before.
 */
import { createEmbedClient, type EmbedClient, type EmbedReply } from "./embed-queue.ts";

export const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";
/** MiniLM-L6-v2 output width. Tests and the bag fallback use this size. */
export const EMBEDDING_DIM = 384;

/** Soft cap so a 28-line window or a long PDF block does not blow up encode time. */
const EMBED_CHARS = 2000;

export type EmbedderFn = (text: string) => Promise<number[]>;

type FeaturePipe = {
  (text: string, options: { pooling: "mean"; normalize: boolean }): Promise<{ data: ArrayLike<number> }>;
};

let embedder: FeaturePipe | EmbedderFn | null = null;
let loading: Promise<FeaturePipe | EmbedderFn> | null = null;
let testEmbedder = false;

/** Tests inject a deterministic embedder so the suite never downloads a model. */
export function setEmbedderForTests(next: EmbedderFn | null): void {
  embedder = next;
  testEmbedder = next !== null;
  loading = null;
}

let client: EmbedClient | null = null;

/** The worker that runs the model, or null where there is none to start (a server, a test in node). */
function workerClient(): EmbedClient | null {
  if (testEmbedder || typeof window === "undefined" || typeof Worker === "undefined") return null;
  if (window.__mockEmbedder) return null;
  client ??= createEmbedClient(() => {
    const worker = new Worker(new URL("./embed-worker.ts", import.meta.url), { type: "module" });
    return {
      post: (request) => worker.postMessage(request),
      listen: (onReply, onCrash) => {
        worker.onmessage = (event: MessageEvent<EmbedReply>) => onReply(event.data);
        worker.onerror = (event) => onCrash(event.message || "The embedding worker stopped.");
        worker.onmessageerror = () => onCrash("The embedding worker sent something unreadable.");
      },
      close: () => worker.terminate(),
    };
  });
  return client;
}

export async function getEmbedder(): Promise<FeaturePipe | EmbedderFn> {
  if (typeof window !== "undefined" && window.__mockEmbedder) return window.__mockEmbedder;
  if (embedder) return embedder;
  if (loading) return loading;
  loading = loadPipeline();
  try {
    embedder = await loading;
    return embedder;
  } finally {
    loading = null;
  }
}

async function loadPipeline(): Promise<FeaturePipe> {
  const { pipeline, env } = await import("@huggingface/transformers");
  env.allowLocalModels = true;
  env.useBrowserCache = true;
  // transformers.js fetches the ONNX Runtime engine from cdn.jsdelivr.net by
  // default, which the app's Content-Security-Policy blocks on purpose. The
  // same files are served from this origin at /vad/ (vite.config.ts
  // vadAssetsPlugin), where the captions worker already loads them from.
  const wasm = env.backends?.onnx?.wasm;
  if (wasm && typeof location !== "undefined") wasm.wasmPaths = `${location.origin}/vad/`;
  return (await pipeline("feature-extraction", MODEL_NAME)) as FeaturePipe;
}

/**
 * What is embedded for a chunk: its path, the heading it sits under, and its
 * text.
 *
 * The heading is what a chunk lost by being cut out of its document: rows 40
 * to 52 of a spreadsheet do not say what their columns are, and the third
 * paragraph of a section does not say which section. It is left out when the
 * chunk's first line already holds it, as the first chunk of a section does.
 * A chunk with no heading embeds exactly as it did before.
 */
export function embeddingTextFor(text: string, path?: string, heading?: string): string {
  const body = text.length > EMBED_CHARS ? text.slice(0, EMBED_CHARS) : text;
  const firstLine = text.slice(0, text.indexOf("\n") < 0 ? text.length : text.indexOf("\n"));
  const lead = heading && !firstLine.includes(heading) ? `${heading}\n` : "";
  return path ? `${path}\n${lead}${body}` : `${lead}${body}`;
}

export async function embedText(text: string): Promise<number[]> {
  if (typeof window !== "undefined" && window.__mockEmbedder) {
    return window.__mockEmbedder(text);
  }
  // One text is a question (or the warm-up's probe): it goes ahead of chunks.
  const worker = workerClient();
  if (worker) return (await worker.embed([text], "query"))[0] ?? [];
  const pipe = await getEmbedder();
  if (testEmbedder) return (pipe as EmbedderFn)(text);
  const result = await (pipe as FeaturePipe)(text, { pooling: "mean", normalize: true });
  return Array.from(result.data);
}

/** Batch encode. Falls back to sequential embedText if the pipe rejects a list. */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  if (testEmbedder) return Promise.all(texts.map((text) => embedText(text)));
  // A list is chunks being indexed: behind any question that is waiting.
  const worker = workerClient();
  if (worker) return worker.embed(texts, "bulk");
  try {
    const pipe = await getEmbedder();
    const result = await (pipe as FeaturePipe)(texts as unknown as string, { pooling: "mean", normalize: true });
    const data = Array.from(result.data);
    if (data.length === texts.length * EMBEDDING_DIM) {
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += 1) {
        out.push(data.slice(i * EMBEDDING_DIM, (i + 1) * EMBEDDING_DIM));
      }
      return out;
    }
  } catch {
    // Sequential encode still produces candidates; lexical retrieve stays up.
  }
  return Promise.all(texts.map((text) => embedText(text)));
}

/**
 * Deterministic 384-d bag embedding for tests and eval when the MiniLM
 * checkpoint is not loaded. Identical strings cosine to 1; unrelated prose
 * stays well below 0.5.
 */
export function bagEmbedding384(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    vec[fnv(token) % EMBEDDING_DIM] += 1;
    if (token.length >= 3) {
      for (let i = 0; i <= token.length - 3; i += 1) {
        vec[fnv(token.slice(i, i + 3)) % EMBEDDING_DIM] += 0.35;
      }
    }
  }
  let norm = 0;
  for (const n of vec) norm += n * n;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  return vec.map((n) => n / norm);
}

function fnv(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function cosineSimilarity(a: ArrayLike<number>, b: ArrayLike<number>): number {
  const n = Math.min(a.length, b.length);
  if (n === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < n; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
