#!/usr/bin/env node
/**
 * Synthesises the demo's score from scratch: an original A-minor cue written to
 * the ad's cut points, so nothing here is licensed from anywhere.
 *
 * The structure is the ad's structure — tense and empty while the question has
 * no answer, an impact on the turn at 11s, a pulse under the payoff, a strip
 * back to almost nothing for the refusal at 32s, and one last swell on the
 * logo. Timings are seconds and must stay in step with SCENES in Demo.tsx.
 *
 * Output lands in assets/remotion/ rather than public/, so the 8MB wav is a
 * build input and never deploys with the site.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const RATE = 48000;
const LENGTH = 43.4;
const N = Math.ceil(RATE * LENGTH);
const OUT = new URL("../assets/remotion/score.wav", import.meta.url).pathname;

const L = new Float32Array(N);
const R = new Float32Array(N);
/** Everything routed here also gets reverb, which keeps the pulse dry and tight. */
const wet = new Float32Array(N);

const TAU = Math.PI * 2;
const NOTE = {
  A1: 55, A2: 110, C3: 130.81, E3: 164.81, F2: 87.31, G2: 98,
  F3: 174.61, G3: 196, A3: 220, B3: 246.94, C4: 261.63, D4: 293.66,
  E4: 329.63, G4: 392, A4: 440, C5: 523.25, E5: 659.25,
};

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Attack/decay envelope with an exponential tail — no clicks, no plastic. */
function env(pos, dur, attack, release) {
  if (pos < 0 || pos > dur) return 0;
  const up = attack <= 0 ? 1 : clamp01(pos / attack);
  const left = dur - pos;
  const down = release <= 0 ? 1 : clamp01(left / release);
  return up * up * (down * down);
}

function add(i, l, r, toWet) {
  if (i < 0 || i >= N) return;
  L[i] += l;
  R[i] += r;
  if (toWet) wet[i] += (l + r) * 0.5;
}

/**
 * Stacked-sine voice. Partial gains taper fast so the pad stays warm rather
 * than organ-like, and each voice is detuned a hair for movement.
 */
function voice({ at, dur, freq, gain, attack = 0.3, release = 0.9, pan = 0, detune = 0, partials = [1, 0.24, 0.09], wetSend = true }) {
  const start = Math.floor(at * RATE);
  const total = Math.ceil(dur * RATE);
  const f = freq * (1 + detune);
  const gl = gain * (1 - Math.max(0, pan)) ;
  const gr = gain * (1 + Math.min(0, pan));
  for (let n = 0; n < total; n++) {
    const t = n / RATE;
    const e = env(t, dur, attack, release);
    if (e <= 0) continue;
    let s = 0;
    for (let p = 0; p < partials.length; p++) {
      s += partials[p] * Math.sin(TAU * f * (p + 1) * t + p);
    }
    // Slow tremolo keeps sustained chords from sounding frozen.
    const move = 1 + 0.05 * Math.sin(TAU * 0.17 * t);
    add(start + n, s * e * gl * move, s * e * gr * move, wetSend);
  }
}

function chordPad(at, dur, freqs, gain) {
  freqs.forEach((freq, i) => {
    const pan = (i / Math.max(1, freqs.length - 1) - 0.5) * 0.7;
    voice({ at, dur, freq, gain, attack: 0.5, release: 1.1, pan, detune: (i % 2 ? 1 : -1) * 0.0016 });
  });
}

function sub(at, dur, freq, gain = 0.5) {
  voice({ at, dur, freq, gain, attack: 0.12, release: 0.7, partials: [1, 0.12], wetSend: false });
}

/** Sine sweep kick: pitch drops fast, body decays slow. */
function kick(at, gain = 0.85) {
  const start = Math.floor(at * RATE);
  const dur = 0.42;
  let phase = 0;
  for (let n = 0; n < dur * RATE; n++) {
    const t = n / RATE;
    const f = 46 + 78 * Math.exp(-t * 26);
    phase += (TAU * f) / RATE;
    const e = Math.exp(-t * 7.5) * (1 - Math.exp(-t * 900));
    const s = Math.sin(phase) * e * gain;
    add(start + n, s, s, false);
  }
}

/** Short filtered-noise transient: the clock in scene 2, the hat later. */
function tick(at, gain, tone = 0.7, pan = 0) {
  const start = Math.floor(at * RATE);
  const dur = 0.055;
  let prev = 0;
  for (let n = 0; n < dur * RATE; n++) {
    const t = n / RATE;
    const raw = Math.random() * 2 - 1;
    // One-pole high-pass by differencing, so it reads as a click not a hiss.
    const hp = raw - prev * tone;
    prev = raw;
    const e = Math.exp(-t * 130) * gain;
    add(start + n, hp * e * (1 - Math.max(0, pan)), hp * e * (1 + Math.min(0, pan)), true);
  }
}

function pluck(at, freq, gain = 0.5, dur = 1.4, pan = 0) {
  voice({ at, dur, freq, gain, attack: 0.006, release: dur * 0.9, pan, partials: [1, 0.3, 0.06] });
}

function arp(at, freq, gain, pan) {
  voice({ at, dur: 0.3, freq, gain, attack: 0.004, release: 0.28, pan, partials: [1, 0.18, 0.35] });
}

/** Noise riser into the turn: gain and brightness climb together. */
function riser(at, dur, gain) {
  const start = Math.floor(at * RATE);
  let lp = 0;
  for (let n = 0; n < dur * RATE; n++) {
    const t = n / RATE;
    const k = t / dur;
    const cutoff = 0.02 + 0.5 * k * k;
    lp += cutoff * (Math.random() * 2 - 1 - lp);
    const e = k * k * gain;
    const wob = 0.85 + 0.15 * Math.sin(TAU * 6 * t);
    add(start + n, lp * e * wob, lp * e * (1.7 - wob), true);
  }
}

function impact(at, gain = 1) {
  sub(at, 3.4, NOTE.A1, 0.85 * gain);
  const start = Math.floor(at * RATE);
  let lp = 0;
  for (let n = 0; n < 0.9 * RATE; n++) {
    const t = n / RATE;
    lp += 0.06 * (Math.random() * 2 - 1 - lp);
    const e = Math.exp(-t * 5.5) * 0.5 * gain;
    add(start + n, lp * e, lp * e, true);
  }
}

// ---------------------------------------------------------------------------
// Arrangement
// ---------------------------------------------------------------------------

const CHORDS = [
  { pad: [NOTE.A3, NOTE.C4, NOTE.E4], root: NOTE.A2, arp: [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.A4] },
  { pad: [NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4], root: NOTE.F2, arp: [NOTE.F3, NOTE.A3, NOTE.C4, NOTE.E4] },
  { pad: [NOTE.C4, NOTE.E4, NOTE.G4], root: NOTE.C3, arp: [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5] },
  { pad: [NOTE.G3, NOTE.B3, NOTE.D4], root: NOTE.G2, arp: [NOTE.G3, NOTE.B3, NOTE.D4, NOTE.G4] },
];

// Scene 1 + 2 — the question with no answer: drone, space, a clock.
voice({ at: 0, dur: 12, freq: NOTE.A1, gain: 0.34, attack: 1.6, release: 2.4, partials: [1, 0.1], wetSend: false });
voice({ at: 0.2, dur: 11, freq: NOTE.A3, gain: 0.05, attack: 2.4, release: 3, pan: -0.4 });
voice({ at: 0.2, dur: 11, freq: NOTE.E4, gain: 0.04, attack: 3, release: 3, pan: 0.4 });
chordPad(4.5, 3.2, [NOTE.A3, NOTE.C4, NOTE.E4], 0.055);
chordPad(7.7, 3.4, [NOTE.F3, NOTE.A3, NOTE.C4], 0.06);
for (let t = 4.5; t < 11; t += 0.5) {
  const late = (t - 4.5) / 6.5;
  tick(t, 0.1 + 0.16 * late, 0.72, t % 1 === 0 ? -0.35 : 0.35);
}
riser(8.4, 2.6, 0.62);

// Scene 3 — the turn.
impact(11);
let chordIndex = 0;
for (let t = 11; t < 32; t += 2) {
  const chord = CHORDS[chordIndex % CHORDS.length];
  chordPad(t, 2.25, chord.pad, t < 15 ? 0.085 : 0.1);
  sub(t, 2.1, chord.root, t < 15 ? 0.42 : 0.5);
  chordIndex++;
}
for (let t = 11; t < 32; t += 1) kick(t, t < 15 ? 0.62 : 0.85);

// Scene 4 — payoff: bass moves, eighth-note arp, offbeat hat.
chordIndex = 0;
for (let t = 15; t < 32; t += 2) {
  const chord = CHORDS[chordIndex % CHORDS.length];
  pluck(t, chord.root * 2, 0.3, 1.5, -0.2);
  pluck(t + 1, chord.root * 2, 0.2, 1.2, 0.2);
  chordIndex++;
}
for (let t = 15.25; t < 32; t += 0.5) tick(t, 0.075, 0.55, t % 1 < 0.5 ? 0.3 : -0.3);

chordIndex = 0;
for (let t = 15; t < 23; t += 0.25) {
  const chord = CHORDS[Math.floor((t - 11) / 2) % CHORDS.length];
  const note = chord.arp[chordIndex % chord.arp.length];
  arp(t, note, 0.075, chordIndex % 2 ? 0.45 : -0.45);
  chordIndex++;
}

// Scene 5 — breadth: sixteenths, brighter, the energy peak.
chordIndex = 0;
for (let t = 23; t < 32; t += 0.125) {
  const chord = CHORDS[Math.floor((t - 11) / 2) % CHORDS.length];
  const note = chord.arp[chordIndex % chord.arp.length] * (chordIndex % 8 >= 4 ? 2 : 1);
  arp(t, note, 0.05, chordIndex % 2 ? 0.5 : -0.5);
  chordIndex++;
}
// A held top line over the peak so it reads as a melody, not just texture.
voice({ at: 23, dur: 4.4, freq: NOTE.E5, gain: 0.045, attack: 0.9, release: 2, pan: 0.2 });
voice({ at: 27.4, dur: 4.6, freq: NOTE.C5, gain: 0.05, attack: 0.9, release: 2.4, pan: -0.2 });

// Scene 6 — the refusal: everything drops away. The silence is the point.
sub(32, 5.2, NOTE.A1, 0.34);
chordPad(32.2, 4.8, [NOTE.A3, NOTE.C4], 0.032);
tick(32, 0.12, 0.8);

// Scene 7 — close: one swell, then let it go.
impact(38, 0.85);
chordPad(38, 4.4, [NOTE.A3, NOTE.C4, NOTE.E4, NOTE.A4], 0.11);
voice({ at: 38, dur: 4.4, freq: NOTE.B3, gain: 0.03, attack: 1.2, release: 2.6 });
sub(38, 4.3, NOTE.A2, 0.5);

// ---------------------------------------------------------------------------
// Reverb (Schroeder: four combs into two allpasses) and master
// ---------------------------------------------------------------------------

function comb(input, delay, feedback) {
  const out = new Float32Array(input.length);
  const buf = new Float32Array(delay);
  let i = 0;
  for (let n = 0; n < input.length; n++) {
    const v = buf[i];
    out[n] = v;
    buf[i] = input[n] + v * feedback;
    i = (i + 1) % delay;
  }
  return out;
}

function allpass(input, delay, gain) {
  const out = new Float32Array(input.length);
  const buf = new Float32Array(delay);
  let i = 0;
  for (let n = 0; n < input.length; n++) {
    const v = buf[i];
    out[n] = -input[n] * gain + v;
    buf[i] = input[n] + v * gain;
    i = (i + 1) % delay;
  }
  return out;
}

function reverb(input, spread) {
  const combs = [1557, 1617, 1491, 1422].map((d) => comb(input, d + spread, 0.76));
  const summed = new Float32Array(input.length);
  for (const c of combs) for (let n = 0; n < input.length; n++) summed[n] += c[n] * 0.25;
  return allpass(allpass(summed, 225 + spread, 0.5), 556 + spread, 0.5);
}

const revL = reverb(wet, 0);
const revR = reverb(wet, 23);

let peak = 0;
for (let n = 0; n < N; n++) {
  // Tail fade so the file can't end on a step.
  const fade = n > N - RATE * 0.6 ? (N - n) / (RATE * 0.6) : 1;
  L[n] = Math.tanh((L[n] + revL[n] * 0.34) * 0.9) * fade;
  R[n] = Math.tanh((R[n] + revR[n] * 0.34) * 0.9) * fade;
  peak = Math.max(peak, Math.abs(L[n]), Math.abs(R[n]));
}

// Leave headroom: this plays under type, it isn't the point of the video.
const gain = (0.72 / peak) || 1;

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
  bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(L[n] * gain * 32767))), 44 + n * 4);
  bytes.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(R[n] * gain * 32767))), 46 + n * 4);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, bytes);
console.log(`score  ${LENGTH}s  ${(bytes.length / 1e6).toFixed(1)}MB  peak ${peak.toFixed(2)} → ${OUT}`);
