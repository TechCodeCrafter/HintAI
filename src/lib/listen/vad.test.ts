import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FLOOR_MULTIPLIER,
  SILERO_SPEECH,
  type VadLane,
  gateFor,
  observeFrame,
  sileroVoiced,
} from "./vad.ts";

/** The production CALL lane threshold and frame size. */
const BASE = 0.024;
const FRAME_MS = 128;

type Row = {
  i: number;
  level: number;
  gate: number;
  voiced: boolean;
  floorBefore: number;
  floorAfter: number;
};

/**
 * Runs a level sequence through the detector with the same transition the audio
 * callback applies: an idle lane that sees a voiced frame goes active.
 */
function run(levels: number[], base = BASE) {
  const lane: VadLane = { vad: base, floor: 0, mode: "idle" };
  const log: Row[] = [];
  let openAt = -1;
  levels.forEach((level, i) => {
    const { gate, voiced, floorBefore } = observeFrame(lane, level);
    if (lane.mode === "idle" && voiced) {
      if (openAt < 0) openAt = i;
      lane.mode = "active";
    }
    log.push({ i, level, gate, voiced, floorBefore, floorAfter: lane.floor });
  });
  return { openAt, openMs: openAt < 0 ? -1 : openAt * FRAME_MS, log, lane };
}

test("the invariant: a frame's gate never depends on that frame", () => {
  // Levels chosen to cross the gate in both directions, including exact zero.
  const levels = [0, 0, 0.01, 0.145, 0.09, 0.2, 0, 0.03, 0.008, 0.5];
  for (const row of run(levels).log) {
    assert.equal(
      row.gate,
      Math.max(BASE, row.floorBefore * FLOOR_MULTIPLIER),
      `frame ${row.i} was classified against a gate derived from itself`,
    );
  }
});

test("CASE 1: digital silence then strong speech", () => {
  const { openAt, log } = run([0, 0, 0, 0.145]);
  const speech = log[3];
  assert.equal(speech.gate, BASE, "the speech frame must be judged against the base gate");
  assert.ok(speech.voiced, "0.145 must classify as voiced");
  assert.equal(openAt, 3, "the lane must open on the first speech frame");
  // The frame that opened the lane must not have seeded the floor with itself.
  assert.equal(speech.floorAfter, 0);
  assert.ok(
    log.every((r) => r.floorAfter !== 0.145),
    "the floor must never become the speech level",
  );
});

test("CASE 2: quiet background then speech", () => {
  const { openAt, log } = run([0.01, 0.011, 0.009, 0.12]);
  const quiet = log.slice(0, 3);
  assert.ok(quiet.every((r) => !r.voiced), "background below the base gate is not speech");
  assert.ok((quiet.at(-1)?.floorAfter ?? 0) > 0, "quiet frames may establish the floor");

  const speech = log[3];
  assert.equal(speech.floorAfter, speech.floorBefore, "speech must not update the floor");
  assert.ok(speech.level > speech.gate, "speech must exceed the computed gate");
  assert.equal(openAt, 3);
});

test("CASE 3: gradual speech onset opens on the first frame over the gate", () => {
  const { openAt, openMs, log } = run([0, 0, 0.03, 0.045, 0.07, 0.12]);
  assert.equal(openAt, 2, "0.03 already clears the base gate");
  assert.ok(openMs < 1000, `opened after ${openMs}ms — the detector chased speech upward`);
  // The failure mode being guarded: the floor rising with each louder frame.
  assert.ok(
    log.every((r) => r.gate === BASE),
    "the gate must not climb as speech gets louder",
  );
});

test("CASE 4: Listen starts while someone is already speaking", () => {
  const { openAt, log } = run([0.13, 0.14, 0.12]);
  assert.equal(log[0].floorBefore, 0, "the floor starts unseeded");
  assert.equal(log[0].gate, BASE, "so the base gate applies");
  assert.ok(log[0].voiced);
  assert.equal(openAt, 0, "the very first frame must open the lane");
  assert.equal(log[0].floorAfter, 0, "a speech frame cannot seed the floor");
});

test("CASE 5: long digital silence then speech", () => {
  const levels = [...Array(3000).fill(0), 0.145];
  const { openAt, log } = run(levels);
  assert.equal(openAt, 3000, "speech must open immediately however long the silence was");
  assert.equal(log[2999].floorAfter, 0, "zero silence leaves the floor at zero");
  assert.equal(log[3000].gate, BASE, "a zero floor safely yields the base threshold");
  assert.equal(log[3000].floorAfter, 0);
});

test("CASE 6: ordinary low-level background still trains the floor", () => {
  const background = Array.from({ length: 60 }, (_, i) => 0.008 + (i % 3) * 0.001);
  const { openAt, log, lane } = run([...background, 0.05]);
  assert.ok(lane.floor > 0, "a real background level must be measured");
  assert.ok(lane.floor <= 0.011, `floor ${lane.floor} drifted above the background`);
  assert.ok(
    log.slice(0, 60).every((r) => !r.voiced),
    "background below the base gate must never open the lane",
  );
  assert.equal(openAt, 60, "speech above the background still opens");
});

test("a measured background raises the gate above noise that would clear base", () => {
  // Why the adaptive floor exists: on a hissy tab, base alone is too low. The
  // floor can only be learned from frames judged non-speech, so it is trained by
  // background that sits under base.
  const { openAt, lane } = run([...Array(40).fill(0.02), 0.033]);
  assert.ok(lane.floor > 0.019 && lane.floor <= 0.021, `floor ${lane.floor} mistracked`);
  assert.equal(gateFor(lane), lane.floor * FLOOR_MULTIPLIER);
  assert.equal(openAt, -1, "0.033 is under 1.8x the measured background, so not speech");
});

test("background already above base opens the lane, by definition of base", () => {
  // A deliberate consequence of the ordering fix. Previously the first frame
  // seeded the floor with itself and suppressed this, at the cost of eating the
  // opening word of real questions. With the floor unknown, base is the only
  // evidence available, and base says 0.05 is speech. The lane returns to idle
  // after the commit, so the first dip below base trains the floor and the gate
  // rises from then on.
  const { openAt } = run(Array(10).fill(0.05));
  assert.equal(openAt, 0);
});

test("the floor is frozen while a lane is active", () => {
  const lane: VadLane = { vad: BASE, floor: 0.01, mode: "active" };
  observeFrame(lane, 0.0001);
  assert.equal(lane.floor, 0.01, "quiet between syllables is not background");
});

test("Silero speech probability at the threshold is voiced", () => {
  assert.equal(sileroVoiced(SILERO_SPEECH), true);
  assert.equal(sileroVoiced(SILERO_SPEECH - 0.01), false);
  assert.equal(sileroVoiced(0.92), true);
});

test("silence after an utterance retrains the floor once the lane is idle", () => {
  const lane: VadLane = { vad: BASE, floor: 0.2, mode: "idle" };
  for (let i = 0; i < 5; i += 1) observeFrame(lane, 0.005);
  assert.ok(lane.floor <= 0.005, `floor ${lane.floor} did not recover after speech`);
});
