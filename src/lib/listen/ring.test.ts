import assert from "node:assert/strict";
import { test } from "node:test";

import { clearRing, keepSamplesFor, newRing, pushRing, ringMs } from "./ring.ts";

const RATE = 16000;
/** A convenient test chunk. Production frames come from the PCM AudioWorklet. */
const FRAME = 2048;
const FRAME_MS = (FRAME / RATE) * 1000; // 128

function frame(fill: number, len = FRAME) {
  return new Float32Array(len).fill(fill);
}

/**
 * Feeds well past the budget so the ring is in its steady state. A ring that has
 * not yet received the requested duration legitimately holds less.
 */
function settle(requestMs: number, len = FRAME, extra = 20) {
  const ring = newRing();
  const keep = keepSamplesFor(requestMs, RATE);
  const pushes = Math.ceil(keep / len) + extra;
  for (let i = 0; i < pushes; i += 1) pushRing(ring, frame(i + 1, len), keep);
  return ring;
}

test("128ms frames: retention is never below the requested pre-roll", () => {
  for (const requested of [500, 1000, 1500]) {
    const ring = settle(requested);
    const held = ringMs(ring, RATE);
    assert.ok(
      held >= requested,
      `${requested}ms requested, only ${held}ms retained`,
    );
    // The documented bound: never more than one frame beyond the request.
    assert.ok(held < requested + FRAME_MS, `${requested}ms requested, ${held}ms is over budget`);
  }
});

test("128ms frames: the frame counts match ceil(request / frame)", () => {
  const expected = { 500: 4, 1000: 8, 1500: 12 };
  for (const [requested, frames] of Object.entries(expected)) {
    const ring = settle(Number(requested));
    assert.equal(ring.frames.length, frames, `${requested}ms should keep ${frames} frames`);
    assert.equal(ringMs(ring, RATE), frames * FRAME_MS);
  }
});

test("the 500ms request that used to retain 384ms now retains 512ms", () => {
  assert.equal(ringMs(settle(500), RATE), 512);
});

test("retention holds for frame sizes that do not divide the request", () => {
  for (const len of [128, 256, 441, 1024, 2048, 4096]) {
    for (const requested of [500, 1000, 1500]) {
      const held = ringMs(settle(requested, len), RATE);
      assert.ok(held >= requested, `${len}-sample frames: ${requested}ms requested, ${held}ms held`);
      const frameMs = (len / RATE) * 1000;
      assert.ok(held < requested + frameMs, `${len}-sample frames: ${held}ms exceeds the bound`);
    }
  }
});

test("eviction drops the oldest first and preserves order", () => {
  const ring = newRing();
  const keep = keepSamplesFor(500, RATE);
  for (let i = 1; i <= 10; i += 1) pushRing(ring, frame(i), keep);
  // Ten frames pushed, four retained: the last four, oldest first.
  assert.deepEqual(
    ring.frames.map((f) => f[0]),
    [7, 8, 9, 10],
  );
});

test("a ring shorter than the request keeps everything it has", () => {
  const ring = newRing();
  const keep = keepSamplesFor(1000, RATE);
  pushRing(ring, frame(1), keep);
  pushRing(ring, frame(2), keep);
  assert.equal(ring.frames.length, 2);
  assert.equal(ringMs(ring, RATE), 256);
});

test("samples stay consistent with the retained frames", () => {
  const ring = settle(1000);
  const summed = ring.frames.reduce((n, f) => n + f.length, 0);
  assert.equal(ring.samples, summed);
});

test("growth is bounded no matter how long the lane stays idle", () => {
  const ring = settle(500, FRAME, 5000); // ~11 minutes of idle audio
  assert.equal(ring.frames.length, 4);
  assert.equal(ring.samples, 4 * FRAME);
});

test("a zero or missing budget still retains the newest frame", () => {
  const ring = newRing();
  pushRing(ring, frame(1), keepSamplesFor(0, RATE));
  pushRing(ring, frame(2), keepSamplesFor(0, RATE));
  assert.equal(ring.frames.length, 1);
  assert.equal(ring.frames[0][0], 2);
});

test("clearing resets both the frames and the sample count", () => {
  const ring = settle(1000);
  clearRing(ring);
  assert.equal(ring.frames.length, 0);
  assert.equal(ring.samples, 0);
  assert.equal(ringMs(ring, RATE), 0);
});
