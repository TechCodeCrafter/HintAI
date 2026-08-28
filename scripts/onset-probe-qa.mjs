#!/usr/bin/env node
/**
 * Phase 1 of the onset investigation: locate where the opening words are lost.
 *
 * Plays byte-identical CALL-lane audio repeatedly and, for each attempt, reads
 * the in-page probe to get the audio actually handed to Whisper. The clip is
 * cross-correlated against the source WAV on its energy envelope, which gives
 * the onset loss in milliseconds as a measurement rather than an inference from
 * the transcript.
 *
 * node scripts/onset-probe-qa.mjs [reps]
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const target = process.env.QA_URL || "http://127.0.0.1:8080/";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const AUDIO = `${ROOT}.qa-audio/call-p0/`;
const OUT = `${ROOT}screenshots/onset/`;
mkdirSync(AUDIO, { recursive: true });
mkdirSync(OUT, { recursive: true });
const REPS = Number(process.argv[2] ?? 3);
const VOICE = process.env.QA_THEM || "Daniel";
// Sweep values without rebuilding; omitted means the shipped defaults.
const TUNING = {};
if (process.argv[3]) TUNING.preRollMs = Number(process.argv[3]);
if (process.argv[4]) TUNING.hangoverMs = Number(process.argv[4]);
const LIGHT = process.argv.includes("light");

const pack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));
const fileText = new Map(pack.files.map((f) => [f.path, f.content]));

const QUESTIONS = [
  { id: "q3", text: "Where does document upload happen?", cite: "upload" },
  { id: "q2", text: "How does the Excel export work?", cite: "excel_output_generator" },
  { id: "q4", text: "Why is the extraction done in a container lambda?", cite: "container-lambdas|iceberg|extraction" },
  { id: "q1", text: "What does the BDA ingest worker do?", cite: "bda-ingest-worker" },
  { id: "q5", text: "How is the data indexed for RAG?", cite: "global-rag" },
];
// `[[slnc N]]` makes `say` insert a real N-ms pause, which is how we test that a
// natural intra-sentence gap no longer splits the question.
const PAUSED = [
  { id: "p3", text: "Where does document [[slnc 600]] upload happen?", clean: "Where does document upload happen?", cite: "upload" },
  { id: "p2", text: "How does the Excel [[slnc 600]] export work?", clean: "How does the Excel export work?", cite: "excel_output_generator" },
  { id: "p4", text: "Why is the extraction [[slnc 600]] done in a container lambda?", clean: "Why is the extraction done in a container lambda?", cite: "container-lambdas|iceberg|extraction" },
];
const CHATTER = [
  "Can you hear me?",
  "Can everyone see my screen?",
  "Should we move on?",
  "Sorry, can you repeat that?",
  "Any questions?",
  "Are we good on time?",
];

function wav(id, text) {
  // Keyed by the text, so changing a question can never replay a stale clip.
  const tag = createHash("sha1").update(text).digest("hex").slice(0, 8);
  const out = `${AUDIO}${id}-${tag}.wav`;
  if (existsSync(out)) return out;
  const aiff = `${AUDIO}${id}-${tag}.aiff`;
  try {
    execFileSync("say", ["-v", VOICE, "-o", aiff, text]);
  } catch {
    execFileSync("say", ["-o", aiff, text]);
  }
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@48000", "-c", "1", aiff, out]);
  return out;
}

/** Int16 mono PCM out of a RIFF file, with its sample rate. */
function readWav(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const sampleRate = view.getUint32(24, true);
  let offset = 12;
  while (offset < bytes.length - 8) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === "data") {
      const count = Math.floor(size / 2);
      const out = new Float32Array(count);
      for (let i = 0; i < count; i += 1) out[i] = view.getInt16(offset + 8 + i * 2, true) / 32768;
      return { samples: out, sampleRate };
    }
    offset += 8 + size + (size % 2);
  }
  return { samples: new Float32Array(0), sampleRate };
}

/** Per-binMs RMS, so two clips at different sample rates stay comparable. */
function envelope(samples, sampleRate, binMs = 20) {
  const bin = Math.max(1, Math.round((sampleRate * binMs) / 1000));
  const out = [];
  for (let i = 0; i < samples.length; i += bin) {
    let sum = 0;
    let n = 0;
    for (let j = i; j < i + bin && j < samples.length; j += 1) {
      sum += samples[j] * samples[j];
      n += 1;
    }
    out.push(Math.sqrt(sum / Math.max(n, 1)));
  }
  return out;
}

/**
 * Offset, in bins, where `clip` best matches inside `source`. A positive result
 * is audio the clip never received.
 */
function bestOffset(source, clip) {
  if (!clip.length || !source.length) return { bins: 0, score: 0 };
  const norm = (a) => {
    const mean = a.reduce((s, v) => s + v, 0) / a.length;
    const dev = Math.sqrt(a.reduce((s, v) => s + (v - mean) ** 2, 0) / a.length) || 1e-9;
    return a.map((v) => (v - mean) / dev);
  };
  const c = norm(clip);
  let best = { bins: 0, score: -Infinity };
  // Search the whole source, comparing only the overlapping region, so a clip
  // that lost most of its front is not clamped to source.length - clip.length.
  for (let shift = 0; shift < source.length; shift += 1) {
    const window = source.slice(shift, shift + c.length);
    if (window.length < 15) break;
    const w = norm(window);
    let dot = 0;
    for (let i = 0; i < w.length; i += 1) dot += w[i] * c[i];
    // Scaled by overlap so a short, well-matching tail cannot beat a full match.
    const score = (dot / w.length) * (w.length / c.length);
    if (score > best.score) best = { bins: shift, score };
  }
  return best;
}

const GLUE = new Set([
  "this","that","with","from","into","also","when","which","where","their","them","there","then",
  "have","been","being","does","service","split","across","work","plus","more","other","using",
  "rdb-labsai-backend","fastapi",
]);
function claimSupport(say, citePaths) {
  const corpus = citePaths.map((p) => fileText.get(p) ?? "").join("\n").toLowerCase();
  const content = [
    ...new Set(
      say.toLowerCase().split(/\s+/)
        .map((w) => w.replace(/^[^a-z0-9_]+/, "").replace(/[^a-z0-9_]+$/, ""))
        .filter((w) => w.length > 4 && !GLUE.has(w)),
    ),
  ];
  const missing = content.filter((w) => !corpus.includes(w));
  return { ok: missing.length === 0, missing };
}

const browser = await chromium.launch({
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript((wire) => localStorage.setItem("ground.pack", wire), JSON.stringify(pack));
await context.addInitScript(
  ([tune, light]) => {
    window.__GROUND_PROBE__ = true;
    if (light) window.__GROUND_PROBE_LIGHT__ = true;
    if (Object.keys(tune).length) window.__GROUND_TUNING__ = tune;
  },
  [TUNING, LIGHT],
);
await context.addInitScript(() => {
  Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });
  const lanes = {};
  function lane(name) {
    if (!lanes[name]) {
      const ctx = new AudioContext({ sampleRate: 48000 });
      lanes[name] = { ctx, dest: ctx.createMediaStreamDestination() };
    }
    return lanes[name];
  }
  window.__groundPlay = async (name, b64) => {
    const { ctx, dest } = lane(name);
    if (ctx.state !== "running") await ctx.resume();
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    const audio = await ctx.decodeAudioData(bytes.buffer);
    const src = ctx.createBufferSource();
    src.buffer = audio;
    src.connect(dest);
    // Zero the probe clock at the instant audio starts, so decode latency is
    // never mistaken for a late VAD open.
    window.__groundProbe?.reset();
    src.start();
    return audio.duration * 1000;
  };
  navigator.mediaDevices.getUserMedia = async () => lane("mic").dest.stream;
  navigator.mediaDevices.getDisplayMedia = async () => lane("computer").dest.stream;
});

const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const room = page.locator('[data-pane="room"]');
const card = page.locator('[data-pane="card"]');
const sayEl = card.locator("p.font-serif.text-fg").first();

async function readCard() {
  const say = (await sayEl.count()) ? (await sayEl.innerText()).trim() : "";
  const btns = card.locator("button:has(span.font-mono)");
  const n = await btns.count();
  const cites = n ? (await btns.allInnerTexts()).map((t) => t.replace(/\s+/g, "")) : [];
  return { say, cites };
}

/** Word error rate, the direct measure of whether the question survived. */
function words(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}
function wer(want, got) {
  const a = words(want);
  const b = words(got);
  if (!a.length) return b.length ? 1 : 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length] / a.length;
}

/**
 * Did the FIRST spoken word survive? That is the defect under test, and unlike
 * cross-correlation it is unaffected by prepended pre-roll silence.
 */
function keptOpening(want, got) {
  const a = words(want);
  const b = words(got);
  if (!a.length || !b.length) return false;
  return b.includes(a[0]) && b.indexOf(a[0]) <= 1;
}

// The ASR model fetch keeps the network busy, so wait on the DOM, not idle.
await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
await room.waitFor({ state: "visible", timeout: 60000 });
for (let i = 0; i < 400; i += 1) {
  const text = await room.innerText();
  if (!/Downloading captions|Loading captions|Starting captions/i.test(text) && i > 4) break;
  await page.waitForTimeout(250);
}
await page.getByRole("button", { name: /^Listen$/i }).click();
await page.waitForTimeout(2500);
const lanesOk = /separate lanes/i.test(await room.innerText());
console.log(`Call lane: ${lanesOk ? "CALL + MIC separate" : "MIC ONLY"}`);
console.log(`Probe:     ${await page.evaluate(() => Boolean(window.__groundProbe))}\n`);

const rows = [];

async function attempt(item, rep, expectCard) {
  const id = `${item.id ?? "chat"}-${rep}`;
  const file = readFileSync(wav(item.id ?? `chat${CHATTER.indexOf(item.text)}`, item.text));
  const b64 = file.toString("base64");
  const source = readWav(file);
  const srcEnv = envelope(source.samples, source.sampleRate);

  const before = await readCard();
  // Identical repeated audio yields an identical Card, so a text diff cannot
  // see the second one. Count DOM writes to the Card pane instead.
  await page.evaluate(() => {
    window.__cardBumps = 0;
    window.__cardObs?.disconnect();
    const node = document.querySelector('[data-pane="card"]');
    if (!node) return;
    window.__cardObs = new MutationObserver(() => {
      window.__cardBumps += 1;
    });
    window.__cardObs.observe(node, { childList: true, subtree: true, characterData: true });
  });
  const durMs = await page.evaluate(([n, d]) => window.__groundPlay(n, d), ["computer", b64]);
  const endsAt = Date.now() + durMs;

  let fired = false;
  let state = before;
  // Wait on the utterance committing rather than a blind budget: once the
  // transcript lands, a Card is at most a couple of seconds behind, so there is
  // no reason to sit out a long timeout on every repeat.
  const budget = expectCard ? 18000 : 8000;
  let committedAt = null;
  while (Date.now() - endsAt < budget) {
    state = await readCard();
    const seen = await page.evaluate(() => ({
      bumps: window.__cardBumps ?? 0,
      committed: (window.__groundProbe?.events() ?? []).some(
        (e) => e.kind === "committed" || e.kind === "utterance-dropped",
      ),
    }));
    if (state.say && (state.say !== before.say || seen.bumps > 0)) {
      fired = true;
      break;
    }
    if (seen.committed) {
      committedAt = committedAt ?? Date.now();
      // The transcript is in. Give the Card a short grace period, then move on.
      if (Date.now() - committedAt > 3500) break;
    }
    await page.waitForTimeout(120);
  }

  const probe = await page.evaluate(() => {
    const all = window.__groundProbe?.events() ?? [];
    const frames = all.filter((e) => e.kind === "frame" && e.lane === "computer");
    return {
      events: all.filter((e) => e.kind !== "frame"),
      frames: frames.length,
      frameTimes: frames.map((e) => e.t),
      frameMs: frames[0]?.detail?.frameMs ?? null,
      clips: window.__groundProbe?.clips() ?? [],
    };
  });

  // ScriptProcessorNode runs on the main thread: if the thread stalls, frames
  // are never delivered at all. A gap here is audio the lane never saw.
  const interval = probe.frameMs ?? 128;
  let maxGapMs = 0;
  let lostToGapsMs = 0;
  for (let i = 1; i < probe.frameTimes.length; i += 1) {
    const gap = probe.frameTimes[i] - probe.frameTimes[i - 1];
    if (gap > interval * 1.5) {
      maxGapMs = Math.max(maxGapMs, Math.round(gap));
      lostToGapsMs += Math.round(gap - interval);
    }
  }

  const open = probe.events.find((e) => e.kind === "vad-open");
  const end = probe.events.find((e) => e.kind === "utterance-end");
  // One spoken question should be one segment. More means the lane closed
  // mid-sentence and Whisper only ever saw a fragment.
  const opens = probe.events.filter((e) => e.kind === "vad-open");
  const ends = probe.events.filter((e) => e.kind === "utterance-end");
  const drops = probe.events.filter((e) => e.kind === "utterance-dropped");
  const segments = ends.map((e) => `${e.detail.sentMs}ms${e.detail.forced ? "f" : ""}`);
  const whisper = probe.events.find((e) => e.kind === "whisper-done");
  const cleaned = probe.events.find((e) => e.kind === "clean-caption");
  const dropped = probe.events.find((e) => e.kind === "utterance-dropped");
  const clip = probe.clips.filter((c) => c.reason === "final").at(-1);

  let onsetLostMs = null;
  let clipMs = null;
  if (clip?.wav) {
    const bytes = Buffer.from(clip.wav, "base64");
    writeFileSync(`${OUT}${id}.wav`, bytes);
    const got = readWav(new Uint8Array(bytes));
    clipMs = Math.round((got.samples.length / got.sampleRate) * 1000);
    const off = bestOffset(srcEnv, envelope(got.samples, got.sampleRate));
    onsetLostMs = off.bins * 20;
  }

  const support = fired && state.say ? claimSupport(state.say, state.cites.map((c) => c.replace(/:\d+$/, ""))) : null;
  const citeOk = item.cite ? state.cites.some((c) => new RegExp(item.cite).test(c)) : null;

  rows.push({
    id,
    text: item.clean ?? item.text,
    expectCard,
    sourceMs: Math.round(durMs),
    vadOpenMs: open ? open.t : null,
    preRollMs: open?.detail?.preRollMs ?? null,
    preRollSentMs: end?.detail?.preRollMs ?? null,
    mergedMs: open?.detail?.mergedMs ?? null,
    clipMs,
    bufferedMs: end?.detail?.bufferedMs ?? null,
    sentMs: end?.detail?.sentMs ?? null,
    windowTrimMs: end ? Math.max(0, end.detail.bufferedMs - end.detail.sentMs) : null,
    onsetLostMs,
    leadingSilenceMs: clip?.leadingSilenceMs ?? null,
    gate: clip?.gate ?? open?.detail?.gate ?? null,
    whisper: whisper?.detail?.raw ?? (dropped ? `(dropped: ${dropped.detail.tooShort ? "too short" : "no speech"})` : ""),
    cleaned: cleaned?.detail?.cleaned ?? "",
    fired,
    citeOk,
    supported: support?.ok ?? null,
    frames: probe.frames,
    frameMs: interval,
    maxGapMs,
    lostToGapsMs,
    werPct: Math.round(wer(item.clean ?? item.text, cleaned?.detail?.cleaned ?? "") * 100),
    keptOpening: keptOpening(item.clean ?? item.text, cleaned?.detail?.cleaned ?? ""),
    opens: opens.length,
    ends: ends.length,
    drops: drops.length,
    segments,
    dropReasons: drops.map((d) => (d.detail.tooShort ? `short(${d.detail.spokeMs}ms)` : "no-speech")),
  });

  const r = rows.at(-1);
  console.log(
    `[${id}] "${r.text}"\n` +
      `   source ${r.sourceMs}ms · vad open +${r.vadOpenMs}ms · pre-roll held ${r.preRollMs}ms / sent ${r.preRollSentMs}ms · merged ${r.mergedMs}ms · sent ${r.sentMs}ms\n` +
      `   clip to whisper ${r.clipMs}ms · ONSET LOST ${r.onsetLostMs}ms · leading silence ${r.leadingSilenceMs}ms · gate ${r.gate}\n` +
      `   frames ${r.frames} @${r.frameMs}ms · max delivery gap ${r.maxGapMs}ms · audio never delivered ${r.lostToGapsMs}ms\n` +
      `   segments ${r.opens} open / ${r.ends} closed [${r.segments.join(" + ")}] · dropped ${r.drops}${r.dropReasons.length ? ` (${r.dropReasons.join(", ")})` : ""}\n` +
      `   whisper "${r.whisper}"\n` +
      `   cleaned "${r.cleaned}"\n` +
      `   card ${r.fired ? `YES (cite ${r.citeOk ? "ok" : "MISS"}, support ${r.supported ? "ok" : "FAIL"})` : "NO"}`,
  );
  await page.waitForTimeout(1800);
}

console.log("=".repeat(78));
console.log(`TUNING  preRoll=${TUNING.preRollMs ?? "default"} hangover=${TUNING.hangoverMs ?? "default"} probe=${LIGHT ? "light" : "full"}`);
console.log(`QUESTIONS — ${REPS} reps of identical audio`);
console.log("=".repeat(78));
for (const q of QUESTIONS) {
  for (let rep = 1; rep <= REPS; rep += 1) await attempt(q, rep, true);
}
console.log(`\n${"=".repeat(78)}\nPAUSED VARIANTS — a 600ms gap must not split the question\n${"=".repeat(78)}`);
for (const q of PAUSED) {
  for (let rep = 1; rep <= REPS; rep += 1) await attempt(q, rep, true);
}
console.log(`\n${"=".repeat(78)}\nCHATTER — must stay silent\n${"=".repeat(78)}`);
for (const text of CHATTER) {
  await attempt({ text, id: `chat${CHATTER.indexOf(text)}` }, 1, false);
}

const asked = rows.filter((r) => r.expectCard);
const quiet = rows.filter((r) => !r.expectCard);
const losses = asked.filter((r) => r.onsetLostMs != null).map((r) => r.onsetLostMs);
const trims = asked.filter((r) => r.windowTrimMs != null).map((r) => r.windowTrimMs);

console.log(`\n${"=".repeat(78)}\nPHASE 1 FINDINGS\n${"=".repeat(78)}`);
console.log(`Card fired:          ${asked.filter((r) => r.fired).length}/${asked.length}`);
console.log(`false triggers:      ${quiet.filter((r) => r.fired).length}/${quiet.length}`);
console.log(
  `onset lost (ms):     ${losses.length ? `min ${Math.min(...losses)}, median ${losses.slice().sort((a, b) => a - b)[Math.floor(losses.length / 2)]}, max ${Math.max(...losses)}` : "n/a"}`,
);
console.log(
  `window trim (ms):    ${trims.length ? `min ${Math.min(...trims)}, max ${Math.max(...trims)}` : "n/a"}`,
);
console.log(`pre-roll present:    ${asked.every((r) => (r.preRollMs ?? 0) === 0) ? "NO — buffer starts at the detection frame" : "yes"}`);
const gaps = asked.map((r) => r.maxGapMs);
console.log(`max delivery gap:    ${gaps.length ? `${Math.min(...gaps)}–${Math.max(...gaps)}ms (frame interval ${asked[0]?.frameMs}ms)` : "n/a"}`);
console.log(`audio never seen:    ${asked.length ? `${Math.min(...asked.map((r) => r.lostToGapsMs))}–${Math.max(...asked.map((r) => r.lostToGapsMs))}ms` : "n/a"}`);
console.log(`console errors:      ${consoleErrors.length}`);
console.log(`clips written to:    ${OUT}`);

console.log("\nPER-ATTEMPT MATRIX");
const splits = asked.filter((r) => r.ends > 1).length;
console.log(`split mid-sentence:  ${splits}/${asked.length} attempts closed the lane more than once`);
console.log(`fragments dropped:   ${asked.reduce((n, r) => n + r.drops, 0)} across ${asked.length} attempts`);

const intact = asked.filter((r) => r.keptOpening && r.werPct <= 25);
console.log(`question intact:     ${intact.length}/${asked.length} (first word kept and WER <= 25%)`);
console.log(`first word kept:     ${asked.filter((r) => r.keptOpening).length}/${asked.length}`);
console.log(`WER median:          ${asked.length ? `${asked.map((r) => r.werPct).sort((a, b) => a - b)[Math.floor(asked.length / 2)]}%` : "n/a"}`);

console.log("\nid".padEnd(10), "vadOpen".padEnd(9), "preRoll".padEnd(9), "seg".padEnd(5), "WER".padEnd(6), "1st".padEnd(5), "card".padEnd(6), "whisper");
for (const r of rows) {
  console.log(
    String(r.id).padEnd(9),
    `${r.vadOpenMs}ms`.padEnd(9),
    `${r.preRollSentMs}ms`.padEnd(9),
    `${r.ends}`.padEnd(5),
    `${r.werPct}%`.padEnd(6),
    (r.keptOpening ? "ok" : "LOST").padEnd(5),
    (r.fired ? "YES" : "no").padEnd(6),
    `"${String(r.whisper).slice(0, 40)}"`,
  );
}

writeFileSync(`${OUT}matrix.json`, JSON.stringify(rows, null, 2));
await browser.close();
