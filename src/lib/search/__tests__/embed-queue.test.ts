import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BULK_SLICE,
  createEmbedClient,
  type EmbedPort,
  type EmbedReply,
  type EmbedRequest,
} from "../embed-queue.ts";

/**
 * A worker that answers only when the test tells it to, so the order in
 * which requests reach it can be read off `requests`.
 */
function fakeWorker() {
  const requests: EmbedRequest[] = [];
  let opened = 0;
  let closed = 0;
  let reply: ((reply: EmbedReply) => void) | null = null;
  let crash: ((reason: string) => void) | null = null;
  let failOpen = false;

  const open = (): EmbedPort => {
    if (failOpen) throw new Error("no worker here");
    opened += 1;
    return {
      post: (request) => requests.push(request),
      listen: (onReply, onCrash) => {
        reply = onReply;
        crash = onCrash;
      },
      close: () => {
        closed += 1;
      },
    };
  };

  /** One vector per text: [length of the text, 1]. */
  const vectorsFor = (texts: string[]) => new Float32Array(texts.flatMap((text) => [text.length, 1]));

  return {
    open,
    requests,
    opened: () => opened,
    closed: () => closed,
    refuseToOpen: () => {
      failOpen = true;
    },
    allowOpen: () => {
      failOpen = false;
    },
    /** Answers the oldest request not yet answered. */
    answer(at = requests.length - 1) {
      const request = requests[at]!;
      reply!({ type: "result", id: request.id, dim: 2, data: vectorsFor(request.texts) });
    },
    fail(message: string, at = requests.length - 1) {
      reply!({ type: "error", id: requests[at]!.id, message });
    },
    send(message: EmbedReply) {
      reply!(message);
    },
    crash(reason: string) {
      crash!(reason);
    },
  };
}

const texts = (request: EmbedRequest | undefined) => request?.texts;

test("an empty list resolves without opening a worker", async () => {
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open);
  assert.deepEqual(await client.embed([], "bulk"), []);
  assert.equal(worker.opened(), 0);
  assert.equal(client.pending(), 0);
});

test("a question is sent whole and comes back as one vector per text", async () => {
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open);
  const asked = client.embed(["how do retries work", "abc"], "query");
  assert.deepEqual(texts(worker.requests[0]), ["how do retries work", "abc"]);
  worker.answer();
  assert.deepEqual(await asked, [
    [19, 1],
    [3, 1],
  ]);
  assert.equal(client.pending(), 0);
});

test("chunks go to the worker one slice at a time, in order", async () => {
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open, { bulkSlice: 2 });
  const embedded = client.embed(["a", "bb", "ccc", "dddd", "eeeee"], "bulk");

  assert.equal(worker.requests.length, 1, "only one request is with the worker at a time");
  assert.deepEqual(texts(worker.requests[0]), ["a", "bb"]);
  worker.answer();
  assert.deepEqual(texts(worker.requests[1]), ["ccc", "dddd"]);
  worker.answer();
  assert.deepEqual(texts(worker.requests[2]), ["eeeee"]);
  worker.answer();

  assert.deepEqual(
    (await embedded).map((vector) => vector[0]),
    [1, 2, 3, 4, 5],
  );
});

test("the default slice is one chunk, so a question waits for at most one", () => {
  assert.equal(BULK_SLICE, 1);
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open);
  void client.embed(["a", "bb", "ccc"], "bulk").catch(() => {});
  assert.deepEqual(texts(worker.requests[0]), ["a"]);
  client.close();
});

test("a question goes ahead of every chunk that is waiting, then the chunks resume", async () => {
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open);
  const chunks = client.embed(["one", "two22", "three33"], "bulk");
  const later = client.embed(["later chunk"], "bulk");
  assert.deepEqual(texts(worker.requests[0]), ["one"]);

  // Asked while the first chunk is with the worker.
  const question = client.embed(["what is the limit"], "query");
  assert.equal(worker.requests.length, 1, "the chunk in flight is not interrupted");

  worker.answer();
  assert.deepEqual(texts(worker.requests[1]), ["what is the limit"], "the question is next, not chunk two");
  worker.answer();
  assert.deepEqual(await question, [[17, 1]]);

  // The first batch carries on where it stopped, before the later batch.
  assert.deepEqual(texts(worker.requests[2]), ["two22"]);
  worker.answer();
  assert.deepEqual(texts(worker.requests[3]), ["three33"]);
  worker.answer();
  assert.deepEqual(
    (await chunks).map((vector) => vector[0]),
    [3, 5, 7],
  );
  assert.deepEqual(texts(worker.requests[4]), ["later chunk"]);
  worker.answer();
  assert.deepEqual(await later, [[11, 1]]);
  assert.equal(client.pending(), 0);
});

test("questions are answered in the order they were asked", async () => {
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open);
  void client.embed(["chunk"], "bulk");
  const first = client.embed(["first"], "query");
  const second = client.embed(["second!"], "query");
  worker.answer();
  assert.deepEqual(texts(worker.requests[1]), ["first"]);
  worker.answer();
  assert.deepEqual(texts(worker.requests[2]), ["second!"]);
  worker.answer();
  assert.deepEqual(await first, [[5, 1]]);
  assert.deepEqual(await second, [[7, 1]]);
});

test("an error from the worker fails that request only", async () => {
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open);
  const bad = client.embed(["bad"], "query");
  const good = client.embed(["good chunk"], "bulk");
  worker.fail("model could not be loaded");
  await assert.rejects(bad, /model could not be loaded/);

  assert.deepEqual(texts(worker.requests[1]), ["good chunk"], "the next request is still sent");
  worker.answer();
  assert.deepEqual(await good, [[10, 1]]);
  assert.equal(worker.opened(), 1, "the same worker is kept");
});

test("vectors of the wrong size are refused, not stored", async () => {
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open);
  const short = client.embed(["a", "b"], "query");
  worker.send({ type: "result", id: worker.requests[0]!.id, dim: 2, data: new Float32Array(2) });
  await assert.rejects(short, /wrong size/);

  const empty = client.embed(["a"], "query");
  worker.send({ type: "result", id: worker.requests[1]!.id, dim: 0, data: new Float32Array(0) });
  await assert.rejects(empty, /wrong size/);
  assert.equal(client.pending(), 0);
});

test("a reply for a request that is not in flight is ignored", async () => {
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open);
  const asked = client.embed(["hello"], "query");
  worker.send({ type: "result", id: 999, dim: 2, data: new Float32Array([9, 9]) });
  assert.equal(client.pending(), 1);
  worker.answer();
  assert.deepEqual(await asked, [[5, 1]]);
  // The same answer again, late.
  worker.answer(0);
  assert.equal(client.pending(), 0);
});

test("a crash fails everything waiting, and the next call opens a new worker", async () => {
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open);
  const inFlight = client.embed(["a", "b"], "bulk");
  const waiting = client.embed(["question"], "query");
  worker.crash("The embedding worker stopped.");
  await assert.rejects(inFlight, /worker stopped/);
  await assert.rejects(waiting, /worker stopped/);
  assert.equal(client.pending(), 0);
  assert.equal(worker.closed(), 1);

  const again = client.embed(["again"], "query");
  assert.equal(worker.opened(), 2);
  worker.answer();
  assert.deepEqual(await again, [[5, 1]]);
});

test("a worker that cannot be started fails the call, and a later call tries again", async () => {
  const worker = fakeWorker();
  worker.refuseToOpen();
  const client = createEmbedClient(worker.open);
  await assert.rejects(client.embed(["a"], "query"), /no worker here/);
  assert.equal(client.pending(), 0);

  worker.allowOpen();
  const retried = client.embed(["a"], "query");
  worker.answer();
  assert.deepEqual(await retried, [[1, 1]]);
});

test("close ends the worker and fails what was waiting", async () => {
  const worker = fakeWorker();
  const client = createEmbedClient(worker.open);
  const waiting = client.embed(["a", "b", "c"], "bulk");
  client.close();
  await assert.rejects(waiting, /was closed/);
  assert.equal(worker.closed(), 1);
  assert.equal(client.pending(), 0);

  // Closed is not final: the next call starts over.
  const next = client.embed(["next"], "query");
  assert.equal(worker.opened(), 2);
  worker.answer();
  assert.deepEqual(await next, [[4, 1]]);
});
