#!/usr/bin/env node
/**
 * Cite or Silence score: a low pad, barely there. No swell. The empty-card
 * hold is silence on purpose. A separate click.wav is one soft UI tick.
 *
 * Timings must stay in step with SCENES in Demo.tsx / Social.tsx.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const RATE = 48000;
const TAU = Math.PI * 2;
const NOTE = { A1: 55, A2: 110, E3: 164.81 };

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

function env(pos, dur, attack, release) {
  if (pos < 0 || pos > dur) return 0;
  const up = attack <= 0 ? 1 : clamp01(pos / attack);
  const left = dur - pos;
  const down = release <= 0 ? 1 : clamp01(left / release);
  return up * up * (down * down);
}

function writeWav(path, L, R) {
  const N = L.length;
  let peak = 0;
  for (let n = 0; n < N; n++) peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
  const gain = peak > 0 ? 0.55 / peak : 1;
  const bytes = Buffer.alloc(44 + N * 4);
  bytes.write("RIFF", 0);
  bytes.writeUInt32LE(36 + N * 4, 4);
  bytes.write("WAVEfmt ", 8);
  bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20);
  bytes.writeUInt16LE(2, 22);
  bytes.writeUInt32LE(RATE, 24);
  bytes.writeUInt32LE(RATE * 4, 28);
  bytes.writeUInt16LE(4, 32);
  bytes.writeUInt16LE(16, 34);
  bytes.write("data", 36);
  bytes.writeUInt32LE(N * 4, 40);
  for (let n = 0; n < N; n++) {
    const fade = n > N - RATE * 0.4 ? (N - n) / (RATE * 0.4) : 1;
    bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[n] * gain * fade * 32767))), 44 + n * 4);
    bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[n] * gain * fade * 32767))), 46 + n * 4);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return { seconds: N / RATE, mb: bytes.length / 1e6, peak };
}

function padScore(length, holes) {
  const N = Math.ceil(RATE * length);
  const L = new Float32Array(N);
  const R = new Float32Array(N);

  function add(i, l, r) {
    if (i < 0 || i >= N) return;
    L[i] += l;
    R[i] += r;
  }

  function voice({ at, dur, freq, gain, attack = 1.6, release = 2.2, pan = 0 }) {
    const start = Math.floor(at * RATE);
    const total = Math.ceil(dur * RATE);
    const gl = gain * (1 - Math.max(0, pan));
    const gr = gain * (1 + Math.min(0, pan));
    for (let n = 0; n < total; n++) {
      const t = n / RATE;
      const e = env(t, dur, attack, release);
      if (e <= 0) continue;
      const s =
        Math.sin(TAU * freq * t) +
        0.12 * Math.sin(TAU * freq * 2 * t) +
        0.04 * Math.sin(TAU * freq * 3 * t);
      const move = 1 + 0.03 * Math.sin(TAU * 0.11 * t);
      add(start + n, s * e * gl * move, s * e * gr * move);
    }
  }

  // Barely-there drone. Holes are hard silence (the empty card).
  const muted = (t) => holes.some(([from, to]) => t >= from && t < to);

  for (const [at, dur] of [
    [0, length],
  ]) {
    voice({ at, dur, freq: NOTE.A1, gain: 0.22, attack: 2.4, release: 2.8 });
    voice({ at: at + 0.4, dur: dur - 0.4, freq: NOTE.A2, gain: 0.05, attack: 3, release: 3, pan: -0.25 });
    voice({ at: at + 0.8, dur: dur - 0.8, freq: NOTE.E3, gain: 0.03, attack: 3.4, release: 3, pan: 0.28 });
  }

  for (let n = 0; n < N; n++) {
    if (muted(n / RATE)) {
      L[n] = 0;
      R[n] = 0;
    }
  }

  return { L, R };
}

function clickWav() {
  const dur = 0.07;
  const N = Math.ceil(RATE * dur);
  const L = new Float32Array(N);
  const R = new Float32Array(N);
  let prev = 0;
  for (let n = 0; n < N; n++) {
    const t = n / RATE;
    const raw = Math.random() * 2 - 1;
    const hp = raw - prev * 0.72;
    prev = raw;
    const e = Math.exp(-t * 90) * 0.55;
    L[n] = hp * e;
    R[n] = hp * e * 0.92;
  }
  return { L, R };
}

const master = padScore(61.2, [[42, 51]]);
const social = padScore(15.4, [[8, 12]]);
const click = clickWav();

const masterOut = new URL("../assets/remotion/score.wav", import.meta.url).pathname;
const socialOut = new URL("../assets/remotion/score-social.wav", import.meta.url).pathname;
const clickOut = new URL("../assets/remotion/click.wav", import.meta.url).pathname;

const a = writeWav(masterOut, master.L, master.R);
const b = writeWav(socialOut, social.L, social.R);
const c = writeWav(clickOut, click.L, click.R);

console.log(`score   ${a.seconds.toFixed(1)}s  ${a.mb.toFixed(1)}MB  → ${masterOut}`);
console.log(`social  ${b.seconds.toFixed(1)}s  ${b.mb.toFixed(1)}MB  → ${socialOut}`);
console.log(`click   ${c.seconds.toFixed(2)}s  → ${clickOut}`);
