#!/usr/bin/env node
/**
 * Does onset loss correlate with main-thread stalls rather than with VAD tuning?
 *
 * ScriptProcessorNode drops audio outright when its callback is serviced late,
 * so a frame gap is unrecoverable capture loss — no pre-roll can bring it back.
 * For each utterance this prints the largest frame gap alongside the VAD open
 * offset and whether the opening word survived.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const AUDIO = `${ROOT}.qa-audio/starve/`;
mkdirSync(AUDIO, { recursive: true });
const pack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));
const GAP = Number(process.argv[2] ?? 2000);
const TEXT = "What does the BDA ingest worker do?";
const FIRST = "what";

function wav() {
  const out = `${AUDIO}q.wav`;
  if (!existsSync(out)) {
    const aiff = `${AUDIO}q.aiff`;
    execFileSync("say", ["-v", "Daniel", "-o", aiff, TEXT]);
    execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@48000", "-c", "1", aiff, out]);
  }
  return out;
}

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript((w) => localStorage.setItem("ground.pack", w), JSON.stringify(pack));
await context.addInitScript(() => {
  window.__GROUND_PROBE__ = true;
  window.__GROUND_PROBE_LIGHT__ = true;
  Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
  const lanes = {};
  const lane = (n) => {
    if (!lanes[n]) {
      const ctx = new AudioContext({ sampleRate: 48000 });
      lanes[n] = { ctx, dest: ctx.createMediaStreamDestination() };
    }
    return lanes[n];
  };
  window.__groundPlay = async (n, b64) => {
    const { ctx, dest } = lane(n);
    if (ctx.state !== "running") await ctx.resume();
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const audio = await ctx.decodeAudioData(bytes.buffer);
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(dest);
    window.__groundProbe?.reset();
    src.start();
    return audio.duration * 1000;
  };
  navigator.mediaDevices.getUserMedia = async () => lane("mic").dest.stream;
  navigator.mediaDevices.getDisplayMedia = async () => lane("computer").dest.stream;
});

const page = await context.newPage();
const room = page.locator('[data-pane="room"]');
await page.goto("http://127.0.0.1:8080/", { waitUntil: "domcontentloaded", timeout: 60000 });
await room.waitFor({ state: "visible", timeout: 60000 });
for (let i = 0; i < 200; i += 1) {
  const t = await room.innerText();
  if (i > 4 && !/Downloading captions|Loading captions|Starting captions/i.test(t)) break;
  await page.waitForTimeout(250);
}
await page.getByRole("button", { name: /^Listen$/i }).click();
await page.waitForTimeout(2500);

const b64 = readFileSync(wav()).toString("base64");
console.log(`CONFIG  inter-utterance gap ${GAP}ms  probe=light  lane=computer\n`);
console.log("        vadOpen  maxFrameGap  framesLost  firstWord  transcript");

// Whisper often commits after the next clip has already started, so each rep's
// transcript is read from the events still standing just before the next reset.
const rows = [];

for (let rep = 1; rep <= 7; rep += 1) {
  const carried = await page.evaluate(() =>
    (window.__groundProbe?.events() ?? []).filter((e) => e.kind === "committed").map((e) => e.detail?.text ?? ""),
  );
  if (rows.length) rows[rows.length - 1].said.push(...carried);
  if (rep === 7) break;
  const dur = await page.evaluate(([n, d]) => window.__groundPlay(n, d), ["computer", b64]);
  await page.waitForTimeout(dur + GAP);
  const stats = await page.evaluate(() => {
    const ev = window.__groundProbe?.events() ?? [];
    const frames = ev.filter((e) => e.kind === "frame" && e.lane === "computer");
    let maxGap = 0;
    let lost = 0;
    for (let i = 1; i < frames.length; i += 1) {
      const delta = frames[i].t - frames[i - 1].t;
      const expected = frames[i].detail?.frameMs ?? 85;
      const over = delta - expected;
      if (over > 20) lost += over;
      if (delta > maxGap) maxGap = delta;
    }
    const open = ev.find((e) => e.kind === "vad-open" && e.lane === "computer");
    const said = ev.filter((e) => e.kind === "committed").map((e) => e.detail?.text ?? "");
    return { maxGap: Math.round(maxGap), lost: Math.round(lost), open: open ? Math.round(open.t) : null, said };
  });
  rows.push({ rep, ...stats });
}

for (const r of rows) {
  const text = r.said.join(" | ");
  const kept = text.toLowerCase().includes(FIRST) ? "kept" : "LOST";
  console.log(
    `  rep ${r.rep}  ${String(r.open ?? "--").padStart(5)}ms  ${String(r.maxGap).padStart(8)}ms  ${String(r.lost).padStart(8)}ms  ${kept.padEnd(9)}  "${text}"`,
  );
}

await browser.close();
