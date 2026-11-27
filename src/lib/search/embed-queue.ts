/**
 * The page's side of the embedding worker: one queue, questions first.
 *
 * The model runs in a worker so that encoding never holds the page. A
 * worker does one thing at a time, though, and encoding a folder's chunks
 * takes minutes. A question asked meanwhile must not wait for that, so:
 *
 * - One request is with the worker at a time. Everything else waits here,
 *   where its order can still change.
 * - A question's text goes ahead of every chunk that is waiting.
 * - Chunks are sent a few at a time (`bulkSlice`), so the longest a question
 *   waits is one slice, not one whole batch.
 *
 * Nothing here knows about the model. It moves texts out and vectors back,
 * which is what lets it be tested with no worker at all.
 */

export type EmbedPriority = "query" | "bulk";

export type EmbedRequest = { type: "embed"; id: number; texts: string[] };

export type EmbedReply =
  | { type: "result"; id: number; dim: number; data: Float32Array }
  | { type: "error"; id: number; message: string };

/** The worker, as far as the queue needs it. */
export type EmbedPort = {
  post: (request: EmbedRequest) => void;
  /** Called once. `onReply` gets each answer; `onCrash` is called if the worker dies. */
  listen: (onReply: (reply: EmbedReply) => void, onCrash: (reason: string) => void) => void;
  close: () => void;
};

export type EmbedClient = {
  embed: (texts: string[], priority: EmbedPriority) => Promise<number[][]>;
  /** Requests waiting or with the worker. For tests and the debug panel. */
  pending: () => number;
  /** Ends the worker and fails whatever was waiting. The next call opens a new one. */
  close: () => void;
};

/**
 * Chunks sent to the worker per request. A question waits for at most this
 * many to finish.
 *
 * Measured on one thread: a chunk takes about 0.2 ms per character (0.14 s at
 * 700 characters, 0.4 s at the 2,000-character cap). Sending eight chunks of
 * one length in one request takes as long as sending them one by one, and
 * chunks of mixed lengths take twice as long together, because each is padded
 * to the longest. So one at a time is both the shortest wait for a question
 * and the fastest way through a folder.
 */
export const BULK_SLICE = 1;

type Job = {
  texts: string[];
  priority: EmbedPriority;
  vectors: number[][];
  resolve: (vectors: number[][]) => void;
  reject: (error: Error) => void;
};

export function createEmbedClient(open: () => EmbedPort, options: { bulkSlice?: number } = {}): EmbedClient {
  const bulkSlice = Math.max(1, options.bulkSlice ?? BULK_SLICE);
  const jobs: Job[] = [];
  let port: EmbedPort | null = null;
  let nextId = 1;
  /** The request the worker is working on, and the job it belongs to. */
  let sent: { id: number; job: Job; count: number } | null = null;

  const failAll = (reason: string) => {
    const failed = jobs.splice(0);
    sent = null;
    port = null;
    for (const job of failed) job.reject(new Error(reason));
  };

  const drop = (job: Job) => {
    const at = jobs.indexOf(job);
    if (at >= 0) jobs.splice(at, 1);
  };

  const onReply = (reply: EmbedReply) => {
    if (!sent || reply.id !== sent.id) return;
    const { job, count } = sent;
    sent = null;
    if (reply.type === "error") {
      drop(job);
      job.reject(new Error(reply.message));
    } else if (reply.dim <= 0 || reply.data.length !== count * reply.dim) {
      drop(job);
      job.reject(new Error("The embedding worker returned vectors of the wrong size."));
    } else {
      for (let i = 0; i < count; i += 1) {
        job.vectors.push(Array.from(reply.data.subarray(i * reply.dim, (i + 1) * reply.dim)));
      }
      if (job.vectors.length >= job.texts.length) {
        drop(job);
        job.resolve(job.vectors);
      }
    }
    pump();
  };

  function pump() {
    if (sent || jobs.length === 0) return;
    // Questions first, in the order they were asked. Then chunks, oldest first.
    const job = jobs.find((candidate) => candidate.priority === "query") ?? jobs[0]!;
    const from = job.vectors.length;
    const texts = job.priority === "query" ? job.texts.slice(from) : job.texts.slice(from, from + bulkSlice);
    try {
      if (!port) {
        const opened = open();
        // A crash is reported for the worker it happened in, never a later one.
        opened.listen(onReply, (reason) => {
          if (port !== opened) return;
          opened.close();
          failAll(reason);
        });
        port = opened;
      }
      const id = nextId++;
      sent = { id, job, count: texts.length };
      port.post({ type: "embed", id, texts });
    } catch (error) {
      port?.close();
      failAll(error instanceof Error ? error.message : "The embedding worker could not be started.");
    }
  }

  return {
    embed(texts, priority) {
      if (texts.length === 0) return Promise.resolve([]);
      return new Promise<number[][]>((resolve, reject) => {
        jobs.push({ texts, priority, vectors: [], resolve, reject });
        pump();
      });
    },
    pending: () => jobs.length,
    close() {
      port?.close();
      failAll("The embedding worker was closed.");
    },
  };
}
