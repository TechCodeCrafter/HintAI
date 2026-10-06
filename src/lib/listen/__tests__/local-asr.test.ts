import assert from "node:assert/strict";
import test from "node:test";

test("local ASR is enabled by default (opt-out via VITE_LOCAL_ASR=0)", async () => {
  // import.meta.env is undefined under node --test, i.e. the flag is unset.
  const { LOCAL_ASR_ENABLED } = await import("../local-asr.ts");
  assert.equal(LOCAL_ASR_ENABLED, true);
});

test("transcribeLocal returns empty for clips too short to caption", async () => {
  const { transcribeLocal } = await import("../local-asr.ts");
  assert.equal(await transcribeLocal(new Float32Array(100)), "");
});

test("transcribeLocal throws loudly when the worker cannot boot", async () => {
  const { transcribeLocal } = await import("../local-asr.ts");
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    // No window under node, so ensureWorker() can never succeed.
    await assert.rejects(
      transcribeLocal(new Float32Array(1600)),
      /local captions unavailable/,
    );
  } finally {
    console.error = orig;
  }
  assert.ok(errors.length > 0, "expected console.error to record the failure");
  assert.match(String(errors[0]), /local captions unavailable/);
});

test("warmupAsr resolves false without a window", async () => {
  const { warmupAsr } = await import("../local-asr.ts");
  assert.equal(await warmupAsr(), false);
});
