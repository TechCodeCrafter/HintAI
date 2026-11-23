import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LIVE_WINDOW_SIZE,
  OVERLAY_DEFAULTS,
  OVERLAY_MIN_OPACITY,
  OVERLAY_POSITIONS,
  OVERLAY_PREFS_KEY,
  clampOpacity,
  liveWindowFeatures,
  liveWindowOrigin,
  normalizeOverlayPrefs,
  readOverlayPrefs,
  writeOverlayPrefs,
} from "../overlay-prefs.ts";

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const SCREEN = { availWidth: 1440, availHeight: 900 };

test("the second screen starts solid, in the top right corner", () => {
  assert.deepEqual(OVERLAY_DEFAULTS, { position: "top-right", opacity: 1 });
  assert.deepEqual(readOverlayPrefs(memory()), OVERLAY_DEFAULTS);
  assert.deepEqual(readOverlayPrefs(null), OVERLAY_DEFAULTS);
});

test("a saved position and opacity are read back", () => {
  const storage = memory();
  assert.deepEqual(writeOverlayPrefs({ position: "bottom-left", opacity: 0.6 }, storage), {
    position: "bottom-left",
    opacity: 0.6,
  });
  assert.equal(storage.data.get(OVERLAY_PREFS_KEY), '{"position":"bottom-left","opacity":0.6}');
  assert.deepEqual(readOverlayPrefs(storage), { position: "bottom-left", opacity: 0.6 });
});

test("opacity is held between readable and solid", () => {
  assert.equal(OVERLAY_MIN_OPACITY, 0.4);
  assert.equal(clampOpacity(0), 0.4);
  assert.equal(clampOpacity(0.39), 0.4);
  assert.equal(clampOpacity(0.4), 0.4);
  assert.equal(clampOpacity(0.555), 0.56);
  assert.equal(clampOpacity(1.7), 1);
  assert.equal(clampOpacity("0.8"), 0.8);
  assert.equal(clampOpacity("faint"), 1);
  assert.equal(clampOpacity(Number.NaN), 1);
});

test("anything unreadable in storage falls back to the defaults, field by field", () => {
  assert.deepEqual(readOverlayPrefs(memory({ [OVERLAY_PREFS_KEY]: "{broken" })), OVERLAY_DEFAULTS);
  assert.deepEqual(normalizeOverlayPrefs(null), OVERLAY_DEFAULTS);
  assert.deepEqual(normalizeOverlayPrefs({ position: "middle", opacity: 0.7 }), { position: "top-right", opacity: 0.7 });
  assert.deepEqual(normalizeOverlayPrefs({ position: "center" }), { position: "center", opacity: 1 });
  assert.deepEqual(normalizeOverlayPrefs({ position: "top-left", opacity: -3 }), { position: "top-left", opacity: 0.4 });
});

test("storage that refuses the write keeps the choice for the page", () => {
  const refusing = {
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  };
  assert.deepEqual(writeOverlayPrefs({ position: "center", opacity: 0.5 }, refusing), { position: "center", opacity: 0.5 });
});

test("each position puts the live window in that corner of the usable screen", () => {
  const { width, height } = LIVE_WINDOW_SIZE;
  assert.deepEqual(liveWindowOrigin("top-left", SCREEN), { left: 16, top: 16 });
  assert.deepEqual(liveWindowOrigin("top-right", SCREEN), { left: 1440 - width - 16, top: 16 });
  assert.deepEqual(liveWindowOrigin("bottom-left", SCREEN), { left: 16, top: 900 - height - 16 });
  assert.deepEqual(liveWindowOrigin("bottom-right", SCREEN), { left: 1440 - width - 16, top: 900 - height - 16 });
  assert.deepEqual(liveWindowOrigin("center", SCREEN), { left: (1440 - width) / 2, top: (900 - height) / 2 });
});

test("the corner is measured from the screen the browser is on", () => {
  // A second monitor to the right, with a menu bar taking the top 25 pixels.
  const second = { availWidth: 1920, availHeight: 1055, availLeft: 1440, availTop: 25 };
  assert.deepEqual(liveWindowOrigin("top-left", second), { left: 1456, top: 41 });
  assert.deepEqual(liveWindowOrigin("bottom-right", second), {
    left: 1440 + 1920 - LIVE_WINDOW_SIZE.width - 16,
    top: 25 + 1055 - LIVE_WINDOW_SIZE.height - 16,
  });
});

test("on a screen smaller than the window it opens at the screen's own corner", () => {
  const small = { availWidth: 400, availHeight: 600 };
  for (const position of OVERLAY_POSITIONS) {
    assert.deepEqual(liveWindowOrigin(position, small), { left: 0, top: 0 }, position);
  }
});

test("the live window is asked for as a pop-up of a fixed size at that corner", () => {
  assert.equal(
    liveWindowFeatures({ position: "bottom-right", opacity: 0.5 }, SCREEN),
    "popup,width=440,height=640,left=984,top=244",
  );
  assert.equal(liveWindowFeatures(OVERLAY_DEFAULTS, SCREEN), "popup,width=440,height=640,left=984,top=16");
});
