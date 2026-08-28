/**
 * Shadow capture monitor. Test-only, and deliberately inert.
 *
 * It observes the same lane source as the ScriptProcessorNode in order to answer
 * one question: while the main thread stalls and ScriptProcessorNode misses
 * callbacks, does audio keep arriving on the audio rendering thread?
 *
 * It drives nothing — no VAD, no Whisper, no transcript, no gate, no Cards. It
 * keeps no audio, only counters, and posts a summary on a timer rather than per
 * render quantum so the audio thread stays cheap.
 */
class GroundCaptureMonitor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.lane = options?.processorOptions?.lane ?? "unknown";
    this.calls = 0;
    this.frames = 0;
    this.firstTime = -1;
    this.lastTime = -1;
    this.maxGap = 0;
    this.missing = 0;
    this.reportAt = 0;
  }

  process(inputs) {
    const input = inputs[0];
    const channel = input && input[0];
    // A render quantum with no channel data is a genuinely absent input, which is
    // itself worth counting — it is not the same as never being called.
    const size = channel ? channel.length : 0;

    if (this.firstTime < 0) {
      this.firstTime = currentTime;
      this.reportAt = currentTime;
    } else {
      const gap = (currentTime - this.lastTime) * 1000;
      if (gap > this.maxGap) this.maxGap = gap;
      // Expected advance is one quantum. Anything more never reached this thread.
      const quantum = (size || 128) / sampleRate * 1000;
      const lost = gap - quantum;
      if (lost > quantum * 0.5) this.missing += lost;
    }
    this.lastTime = currentTime;
    this.calls += 1;
    this.frames += size;

    if (currentTime - this.reportAt >= 0.25) {
      this.reportAt = currentTime;
      this.port.postMessage({
        lane: this.lane,
        calls: this.calls,
        frames: this.frames,
        firstTime: this.firstTime,
        lastTime: this.lastTime,
        maxGapMs: Math.round(this.maxGap),
        missingMs: Math.round(this.missing),
      });
    }
    // Keep the node alive without contributing to any output.
    return true;
  }
}

registerProcessor("ground-capture-monitor", GroundCaptureMonitor);
