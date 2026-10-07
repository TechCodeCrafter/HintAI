import assert from "node:assert/strict";
import { test } from "node:test";

import { CaptionHealth } from "../caption-health.ts";

test("the lane stays silent through a few network blips, then is declared dead once", () => {
  const health = new CaptionHealth();
  assert.equal(health.dead, false);
  for (let i = 0; i < 4; i += 1) {
    assert.equal(health.noteNetworkError(), false, `error ${i + 1} should not declare death`);
    assert.equal(health.dead, false);
  }
  assert.equal(health.noteNetworkError(), true, "the 5th consecutive error declares death");
  assert.equal(health.dead, true);
});

test("further errors after death do not re-fire the dead signal", () => {
  const health = new CaptionHealth();
  let fired = 0;
  for (let i = 0; i < 10; i += 1) {
    if (health.noteNetworkError()) fired += 1;
  }
  assert.equal(fired, 1);
  assert.equal(health.dead, true);
});

test("a caption result revives the lane", () => {
  const health = new CaptionHealth();
  for (let i = 0; i < 5; i += 1) health.noteNetworkError();
  assert.equal(health.dead, true);
  health.noteHeard();
  assert.equal(health.dead, false);
  assert.equal(health.noteNetworkError(), false, "the counter restarts after a recovery");
});

test("reset clears the counter", () => {
  const health = new CaptionHealth();
  for (let i = 0; i < 4; i += 1) health.noteNetworkError();
  health.reset();
  assert.equal(health.dead, false);
  assert.equal(health.noteNetworkError(), false);
});
