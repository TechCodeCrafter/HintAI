import { transcribeClip } from "@/lib/ai/transcribe";
import { stopListeningAndMic } from "@/lib/listen/speech";

const MAX_MS = 20_000;

let recorder: MediaRecorder | null = null;
let stream: MediaStream | null = null;
let chunks: Blob[] = [];
let timer = 0;
let lastClip: Blob | null = null;

function pickMime(): string {
  const types = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];
  return types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

function writeString(view: DataView, offset: number, value: string) {
  for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
}

function encodeWav(buffer: AudioBuffer, sampleRate = 16000): Blob {
  const ratio = buffer.sampleRate / sampleRate;
  const length = Math.max(1, Math.floor(buffer.duration * sampleRate));
  const src = buffer.getChannelData(0);
  const pcm = new Int16Array(length);
  for (let i = 0; i < length; i += 1) {
    const s = Math.max(-1, Math.min(1, src[Math.min(src.length - 1, Math.floor(i * ratio))] ?? 0));
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
  return new Blob([out], { type: "audio/wav" });
}

async function blobToWav(blob: Blob): Promise<Blob> {
  const ctx = new AudioContext();
  try {
    const buffer = await ctx.decodeAudioData(await blob.arrayBuffer());
    return encodeWav(buffer);
  } finally {
    void ctx.close();
  }
}

function toBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read"));
    reader.onload = () => {
      const raw = String(reader.result ?? "");
      const comma = raw.indexOf(",");
      resolve(comma >= 0 ? raw.slice(comma + 1) : raw);
    };
    reader.readAsDataURL(blob);
  });
}

function release(keepClip = false) {
  window.clearTimeout(timer);
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  recorder = null;
  chunks = [];
  if (!keepClip) lastClip = null;
}

export function isDictating(): boolean {
  return recorder?.state === "recording";
}

export async function startDictate(): Promise<void> {
  if (isDictating()) return;
  stopListeningAndMic();
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    throw new Error("Dictate needs a microphone in this browser.");
  }
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
    video: false,
  });
  chunks = [];
  const mime = pickMime();
  recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };
  recorder.onstop = () => {
    lastClip = new Blob(chunks, { type: recorder?.mimeType || "audio/webm" });
    release(true);
  };
  recorder.start(200);
  timer = window.setTimeout(() => {
    if (recorder?.state === "recording") recorder.stop();
  }, MAX_MS);
}

export async function finishDictate(keyterms: string[] = []): Promise<string> {
  const rec = recorder;
  const blob = rec
    ? await new Promise<Blob>((resolve, reject) => {
        rec.onerror = () => {
          release();
          reject(new Error("Dictate stopped."));
        };
        rec.onstop = () => {
          const type = rec.mimeType || "audio/webm";
          const raw = new Blob(chunks, { type });
          lastClip = raw;
          release(true);
          resolve(raw);
        };
        if (rec.state === "recording") rec.stop();
        else if (lastClip) resolve(lastClip);
        else {
          release();
          reject(new Error("Dictate is not running."));
        }
      })
    : lastClip;
  if (!blob) throw new Error("Dictate is not running.");
  lastClip = null;
  if (blob.size < 800) throw new Error("That clip was empty. Tap Dictate and ask the question.");
  const wav = await blobToWav(blob);
  const audio = await toBase64(wav);
  const result = await transcribeClip({
    data: { audio, mime: "audio/wav", keyterms: keyterms.slice(0, 8) },
  });
  if (!result.ok) throw new Error(result.error);
  return result.text;
}

export function cancelDictate() {
  try {
    recorder?.stop();
  } catch {
    /* ignore */
  }
  release();
}
