import assert from "node:assert/strict";
import test from "node:test";

function withUa(ua: string, touchPoints = 0, fn: () => void) {
  const nav = globalThis.navigator as Navigator & { maxTouchPoints?: number; platform?: string };
  const prevUa = nav.userAgent;
  const prevTouch = nav.maxTouchPoints;
  const prevPlatform = nav.platform;
  Object.defineProperty(nav, "userAgent", { configurable: true, value: ua });
  Object.defineProperty(nav, "maxTouchPoints", { configurable: true, value: touchPoints });
  Object.defineProperty(nav, "platform", { configurable: true, value: touchPoints > 1 ? "MacIntel" : "MacIntel" });
  try {
    fn();
  } finally {
    Object.defineProperty(nav, "userAgent", { configurable: true, value: prevUa });
    Object.defineProperty(nav, "maxTouchPoints", { configurable: true, value: prevTouch });
    Object.defineProperty(nav, "platform", { configurable: true, value: prevPlatform });
  }
}

test("isIOS detects iPad and iPadOS desktop UA", async () => {
  const { isIOS } = await import("../browser-capability.ts");
  withUa("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)", 5, () => {
    assert.equal(isIOS(), true);
  });
  withUa("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15", 5, () => {
    assert.equal(isIOS(), true);
  });
  withUa("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0", 0, () => {
    assert.equal(isIOS(), false);
  });
});

test("tabAudioShareLikely is false on mobile and true on desktop Chrome", async () => {
  const { tabAudioShareLikely } = await import("../browser-capability.ts");
  withUa("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)", 5, () => {
    assert.equal(tabAudioShareLikely(), false);
  });
  withUa("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0", 0, () => {
    assert.equal(tabAudioShareLikely(), true);
  });
});

test("liveCaptionsOk includes desktop Safari but not iOS", async () => {
  const { liveCaptionsOk } = await import("../speech.ts");
  class FakeRec {}
  const w = globalThis as typeof globalThis & { webkitSpeechRecognition?: typeof FakeRec };
  const prev = w.webkitSpeechRecognition;
  w.webkitSpeechRecognition = FakeRec;
  try {
    withUa(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
      0,
      () => {
        assert.equal(liveCaptionsOk(), true);
      },
    );
    withUa("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15", 5, () => {
      assert.equal(liveCaptionsOk(), false);
    });
  } finally {
    if (prev) w.webkitSpeechRecognition = prev;
    else delete w.webkitSpeechRecognition;
  }
});
