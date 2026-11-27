/**
 * Prepares search for the first question on a set of chunks, in the
 * background, and reports how far it has got.
 *
 * Three things make a first question slow, and none of them is the question:
 * the word index is built per chunk the first time a search touches it, the
 * space's vectors are read from this device's database, and the model that
 * embeds a question is loaded. This does all three ahead of time and says
 * where each stands, so Listen can stay off until they are done.
 *
 * Vectors are waited for, for a short while. A folder that was just indexed
 * can take minutes to embed, and holding Listen for that would be worse than
 * what it protects: once the wait is over the report moves to the lexical
 * path, questions are ranked on words and structure, and this keeps watching
 * until the vectors finish and reports that too.
 *
 * Nothing here leaves the device.
 */
import { USE_HYBRID_RETRIEVAL } from "../context/index-versions.ts";
import type { IndexedChunk } from "../repo/types.ts";
import { embedInBackground, embeddingIdle } from "./embed-chunks.ts";
import { embedText } from "./embedding.ts";
import { pendingWarmth, type SearchWarmth, type VectorWarmState } from "./readiness.ts";
import { hybridRetrieve, retrieve, searchIndexWarm, warmSearchIndex } from "./retrieve.ts";
import { vectorCacheKey, type ScopedChunkMeta } from "./retrieval-scope.ts";
import type { VectorStore } from "./vector-store.ts";

/** How long Listen is held for vectors once the word index is built. */
export const VECTOR_WARM_WAIT_MS = 2500;

/** How often the vector count is read while an embedding pass is running. */
const VECTOR_POLL_MS = 400;

/** At most one word-index progress report per interval. */
const PROGRESS_INTERVAL_MS = 80;

/**
 * A question run once the word index is built and before it is reported
 * ready. It loads the code a first search loads and runs the ranking over
 * every chunk, so the first real question is not the one that pays for it.
 */
const PROBE_QUERY = "how does this work";

export type WarmSearchOptions = {
  /** The store these chunks' vectors live in. Null when this device has none. */
  vectorStore: VectorStore | null;
  onChange: (warmth: SearchWarmth) => void;
  /** True once these chunks are no longer the ones in use. Ends the work. */
  isCancelled?: () => boolean;
  /**
   * Other work a first question would otherwise pay for. It runs beside the
   * word index, and words are not reported ready until it has ended.
   */
  prepare?: () => Promise<unknown>;
  vectorWaitMs?: number;
  pollMs?: number;
  sliceMs?: number;
  /** Embeds one text. Loading the model is the point; the vector is thrown away. */
  embed?: (text: string) => Promise<ArrayLike<number>>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

/**
 * True when these chunks are embedded when they are indexed: a vector store
 * is installed and the chunks belong to a stored space. The demo pack is
 * neither stored nor embedded, so it has no vectors to wait for.
 */
export function expectsVectors(chunks: IndexedChunk[], store: VectorStore | null): store is VectorStore {
  if (!USE_HYBRID_RETRIEVAL || !store || chunks.length === 0) return false;
  const meta = chunks[0] as IndexedChunk & ScopedChunkMeta;
  return Boolean(meta.workspaceId && meta.contextId);
}

/**
 * Builds the word index for `chunks` and runs one question over it. Resolves
 * true when both are done, false when it was cancelled first.
 *
 * It runs beside any other warm-up, so the chunks of a re-index can be made
 * ready while the chunks in use are still being searched.
 */
export async function warmWords(
  chunks: IndexedChunk[],
  options: {
    vectorStore: VectorStore | null;
    isCancelled?: () => boolean;
    sliceMs?: number;
    onProgress?: (done: number, total: number) => void;
  },
): Promise<boolean> {
  const cancelled = () => Boolean(options.isCancelled?.());
  const done = await warmSearchIndex(chunks, {
    exclusive: false,
    sliceMs: options.sliceMs,
    isCancelled: cancelled,
    onProgress: options.onProgress,
  });
  if (cancelled() || done < chunks.length) return false;
  if (chunks.length === 0) return true;
  try {
    if (options.vectorStore) {
      await hybridRetrieve(PROBE_QUERY, chunks, options.vectorStore, 6, undefined, { semantic: false });
    } else {
      retrieve(PROBE_QUERY, chunks, 6);
    }
  } catch {
    // The probe only warms things up. A real question reports its own failure.
  }
  return !cancelled();
}

/**
 * Warms search for `chunks` and resolves with the last report: vectors
 * `off` or `ready`, or `lexical` when they cannot be had at all (the model
 * will not load, or nothing was embedded). While vectors are merely late it
 * keeps running, and resolves when they arrive.
 */
export async function warmSearch(chunks: IndexedChunk[], options: WarmSearchOptions): Promise<SearchWarmth> {
  const cancelled = () => Boolean(options.isCancelled?.());
  const now = options.now ?? (() => (typeof performance !== "undefined" ? performance.now() : Date.now()));
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const store = expectsVectors(chunks, options.vectorStore) ? options.vectorStore : null;
  const total = chunks.length;

  const prepared = options.prepare && total > 0 ? options.prepare().catch(() => undefined) : null;
  let warmth = pendingWarmth(total, Boolean(store));
  if (!prepared && searchIndexWarm(chunks)) warmth = { ...warmth, words: { done: total, total, ready: true } };
  const emit = (next: SearchWarmth) => {
    warmth = next;
    if (!cancelled()) options.onChange(next);
  };
  emit(warmth);
  if (total === 0) return warmth;

  // The vector read and the model load start now, beside the word index:
  // they wait on the database and the network cache, not on this thread.
  const keys = store ? [...new Set(chunks.map((chunk) => vectorCacheKey(chunk)))] : [];
  const held = async (): Promise<number> => {
    if (!store) return 0;
    try {
      return (await store.get(keys)).size;
    } catch {
      return 0;
    }
  };
  /** `ok` is null while the model is loading; then whether a question can be embedded. */
  const model: { ok: boolean | null } = { ok: store ? null : false };
  const modelSettled: Promise<void> = store
    ? Promise.resolve()
        .then(() => (options.embed ?? embedText)(PROBE_QUERY))
        .then(
          (vector) => {
            model.ok = vector.length > 0;
          },
          () => {
            model.ok = false;
          },
        )
    : Promise.resolve();
  void held();

  if (!warmth.words.ready) {
    let last = now();
    const finished = await warmWords(chunks, {
      vectorStore: store,
      sliceMs: options.sliceMs,
      isCancelled: cancelled,
      onProgress: (done) => {
        if (done >= total || now() - last < PROGRESS_INTERVAL_MS) return;
        last = now();
        emit({ ...warmth, words: { done, total, ready: false } });
      },
    });
    if (!finished) return warmth;
    if (prepared) {
      await prepared;
      if (cancelled()) return warmth;
    }
    emit({ ...warmth, words: { done: total, total, ready: true } });
  }
  if (!store) return warmth;

  const expected = keys.length;
  const deadline = now() + (options.vectorWaitMs ?? VECTOR_WARM_WAIT_MS);
  const pollMs = options.pollMs ?? VECTOR_POLL_MS;
  const report = (state: VectorWarmState, have: number) => {
    if (warmth.vectors.state === state && warmth.vectors.have === have) return;
    emit({ ...warmth, vectors: { state, have, total: expected } });
  };
  let retried = false;
  for (;;) {
    // Idle is read before the count: a pass that ends between the two reads
    // has written everything the count then sees.
    const idle = await settledNow(embeddingIdle(store));
    const have = await held();
    if (cancelled()) return warmth;
    if (idle && model.ok !== null) {
      if (model.ok && have >= expected) {
        report("ready", have);
        return warmth;
      }
      if (model.ok && !retried) {
        // The pass that indexed these chunks stopped before the end (a later
        // load cancels it). Embed what is missing, once, under this run.
        retried = true;
        void embedInBackground(chunks, store, { isCancelled: cancelled });
        continue;
      }
      // Nothing more is coming. With some vectors, search uses the ones there
      // are, as it did before. With none, or no model, it stays on words.
      report(model.ok && have > 0 ? "ready" : "lexical", have);
      return warmth;
    }
    const left = deadline - now();
    report(left <= 0 ? "lexical" : "warming", have);
    await Promise.race([sleep(left > 0 ? Math.min(pollMs, left) : pollMs), idle ? modelSettled : embeddingIdle(store)]);
    if (cancelled()) return warmth;
  }
}

/** True when `promise` has already settled. Takes one turn of the microtask queue to find out. */
function settledNow(promise: Promise<unknown>): Promise<boolean> {
  const settled = () => true;
  return Promise.race([promise.then(settled, settled), Promise.resolve().then(() => false)]);
}
