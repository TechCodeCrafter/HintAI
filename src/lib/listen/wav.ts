function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

export function wavBytesMono(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const pcm = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i] ?? 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, "data");
  view.setUint32(40, pcm.byteLength, true);
  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(new Uint8Array(pcm.buffer), 44);
  return out;
}

export function encodeWavMono(samples: Float32Array, sampleRate: number): Blob {
  return new Blob([wavBytesMono(samples, sampleRate)], { type: "audio/wav" });
}

export function pcm16kFromFrames(frames: Float32Array[], sampleRate: number): Float32Array {
  let length = 0;
  for (const frame of frames) length += frame.length;
  const samples = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) {
    samples.set(frame, offset);
    offset += frame.length;
  }
  const target = 16000;
  if (sampleRate === target) return samples;
  const ratio = sampleRate / target;
  const next = new Float32Array(Math.max(1, Math.floor(samples.length / ratio)));
  for (let i = 0; i < next.length; i += 1) {
    next[i] = samples[Math.min(samples.length - 1, Math.floor(i * ratio))] ?? 0;
  }
  return next;
}

export function encodeWavFromStreamChunk(frames: Float32Array[], sampleRate: number): Blob {
  return encodeWavMono(pcm16kFromFrames(frames, sampleRate), 16000);
}
