/**
 * Production PCM tap. Runs on the audio thread so a busy main thread cannot
 * drop frames the way ScriptProcessorNode did.
 *
 * Posts one copy of each input quantum. The main thread owns VAD, rings, and
 * Whisper. This processor keeps no audio and does no classification.
 */
class MeetHintPcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.lane = options?.processorOptions?.lane ?? "unknown";
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) {
      const samples = new Float32Array(channel);
      this.port.postMessage({ type: "frame", lane: this.lane, samples, time: currentTime }, [
        samples.buffer,
      ]);
    }
    return true;
  }
}

registerProcessor("meethint-pcm-capture", MeetHintPcmCapture);
