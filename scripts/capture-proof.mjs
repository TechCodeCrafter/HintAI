#!/usr/bin/env node
/**
 * Does ScriptProcessorNode lose PCM, and if so, was that PCM available on the
 * audio thread at the time?
 *
 * For each utterance this prints the chain the decision depends on:
 *   callback gap -> missing PCM -> late VAD open -> lost question onset
 * and, from the shadow AudioWorklet reading the same source, whether the audio
 * thread kept receiving audio through the same window.
 *
 * The probe records only counters and timestamps inside the callback; every
 * measurement below is computed after the utterance.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const AUDIO = `${ROOT}.qa-audio/capture/`;
mkdirSync(AUDIO, { recursive: true });
const THEM = "Daniel";
const REPS = Number(process.argv[2] ?? 3);

const pack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));

const QUESTIONS = [
  { id: "q1", text: "What does the BDA ingest worker do?", first: "what" },
  { id: "q2", text: "How does the Excel export work?", first: "how" },
  { id: "q3", text: "Where does document upload happen?", first: "where" },
  { id: "q4", text: "Why is the extraction done in a container lambda?", first: "why" },
  { id: "q5", text: "How is the data indexed for RAG?", first: "how" },
];

function wav(id, text, voice) {
  const tag = createHash("sha1").update(`${voice}:${text}`).digest("hex").slice(0, 8);
  const out = `${AUDIO}${id}-${tag}.wav`;
  if (existsSync(out)) return out;
  const aiff = `${AUDIO}${id}-${tag}.aiff`;
  try {
    execFileSync("say", ["-v", voice, "-o", aiff, text]);
  } catch {
    execFileSync("say", ["-o", aiff, text]);
  }
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@48000", "-c", "1", aiff, out]);
  return out;
}

function words(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}
function wer(want, got) {
  const a = words(want);
  const b = words(got);
  if (!a.length) return b.length ? 100 : 0;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return Math.round((d[a.length][b.length] / a.length) * 100);
}

const browser = await chromium.launch({
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await context.addInitScript((wire) => localStorage.setItem("ground.pack", wire), JSON.stringify(pack));
await context.addInitScript(() => {
  // Capture counters only. The heavy onset probe stays off so instrumentation
  // cannot manufacture the stall being measured.
  window.__GROUND_CAPTURE__ = true;
  window.__GROUND_PROBE__ = true;
  window.__GROUND_PROBE_LIGHT__ = true;
  window.__GROUND_TUNING__ = { preRollMs: 500, hangoverMs: 900 };
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
    window.__groundProbe?.reset();
    window.__groundCapture?.reset();
    src.start();
    return { durMs: audio.duration * 1000 };
  };
  navigator.mediaDevices.getUserMedia = async () => lane("mic").dest.stream;
  navigator.mediaDevices.getDisplayMedia = async () => lane("computer").dest.stream;
});

const page = await context.newPage();
const room = page.locator('[data-pane="room"]');

await page.goto("http://127.0.0.1:8080/app", { waitUntil: "domcontentloaded", timeout: 60000 });
await room.waitFor({ state: "visible", timeout: 60000 });
for (let i = 0; i < 400; i += 1) {
  const text = await room.innerText();
  if (i > 4 && !/Downloading captions|Loading captions|Starting captions/i.test(text)) break;
  await page.waitForTimeout(250);
}
await page.getByRole("button", { name: /^Listen$/i }).click();
await page.waitForTimeout(2500);

const attached = await page.evaluate(() =>
  (window.__groundCapture?.marks() ?? []).filter((m) => m.kind.startsWith("worklet")),
);
console.log("CAPTURE PROOF   preRoll=500ms  hangover=900ms  probe=counters only");
console.log(`SHADOW WORKLET  ${attached.map((m) => `${m.lane}:${m.kind.replace("worklet-", "")}`).join("  ") || "not attached"}\n`);

const rows = [];
for (let rep = 1; rep <= REPS; rep += 1) {
  for (const q of QUESTIONS) {
    const b64 = readFileSync(wav(q.id, q.text, THEM)).toString("base64");
    const { durMs } = await page.evaluate(([n, d]) => window.__groundPlay(n, d), ["computer", b64]);
    await page.waitForTimeout(durMs + 7000);

    const data = await page.evaluate(() => {
      const cap = window.__groundCapture?.report(16000) ?? { lanes: [], marks: [], worklet: [] };
      const events = window.__groundProbe?.events() ?? [];
      const heard = events.filter((e) => e.kind === "committed").map((e) => e.detail?.text ?? "");
      // The probe clock is reset at src.start(), so `t` is the offset from the
      // first sample of the source audio.
      const open = events.find((e) => e.kind === "vad-open" && e.lane === "computer");
      const mine = (kind) => events.filter((e) => e.kind === kind && e.lane === "computer");
      return {
        cap,
        heard,
        // One question should commit exactly once; more means it was split.
        splits: Math.max(0, mine("utterance-end").length - 1),
        drops: mine("utterance-dropped").length,
        held: mine("fragment-held").length,
        vadOpenMs: open ? Math.round(open.t) : null,
        retainedMs: open?.detail?.preRollMs ?? null,
        requestedMs: open?.detail?.requestedPreRollMs ?? null,
      };
    });

    const sp = data.cap.lanes.find((l) => l.lane === "computer") ?? {};
    const wk = data.cap.worklet.find((w) => w.lane === "computer") ?? null;
    const vad = data.cap.marks.find((m) => m.kind === "vad-open" && m.lane === "computer");
    const firstFrame = data.cap.marks.find((m) => m.kind === "pcm-first-frame" && m.lane === "computer");
    const clip = data.cap.marks.find((m) => m.kind === "clip-committed" && m.lane === "computer");
    const heard = data.heard.join(" | ");
    const kept = heard.toLowerCase().includes(q.first);
    const rate = wer(q.text, heard);

    const vadOffsetMs = data.vadOpenMs;
    const preRollMs = clip?.detail?.preRollMs ?? null;
    // Lead time the ring buffer had already evicted by the time the VAD opened.
    const shortfallMs =
      vadOffsetMs === null || preRollMs === null ? null : Math.max(0, vadOffsetMs - preRollMs);

    rows.push({
      id: `${q.id}-${rep}`,
      q, sp, wk, heard, kept, rate, durMs,
      vadOffsetMs, preRollMs, shortfallMs,
      requestedMs: data.requestedMs,
      retainedMs: data.retainedMs,
      splits: data.splits,
      drops: data.drops,
      held: data.held,
      vadTimeline: data.cap.vad?.computer ?? [],
      clipMs: clip?.detail?.clipMs ?? null,
    });

    const r = rows.at(-1);
    console.log(
      `[${r.id.padEnd(6)}] first-word ${r.kept ? "kept" : "LOST"}  WER ${String(r.rate).padStart(3)}%  ` +
        `frames ${r.sp.frames}/${r.sp.expectedFrames}  missingPCM ${r.sp.missingMs}ms  ` +
        `maxWallGap ${r.sp.maxWallGapMs}ms`,
    );
    // The detector state as the question began: the floor left by the silence
    // before it, and the bar that floor produced.
    const onset = r.vadTimeline.find((f) => f.atMs >= 0);
    console.log(
      `          detector first speech frame ${onset ? `+${onset.atMs}ms level ${onset.level.toFixed(5)}` : "n/a"}  ` +
        `floor before ${onset ? onset.floor.toFixed(5) : "n/a"}  gate ${onset ? onset.gate.toFixed(5) : "n/a"}  ` +
        `${onset?.voiced ? "VOICED" : "not voiced"}`,
    );
    console.log(
      `          preRoll  requested ${r.requestedMs}ms  retained ${r.retainedMs}ms  ` +
        `${r.retainedMs >= r.requestedMs ? "OK" : "UNDER"}   in clip ${r.preRollMs}ms`,
    );
    console.log(
      `          onset    src ${Math.round(r.durMs)}ms  vadOpen +${r.vadOffsetMs}ms  ` +
        `clip ${r.clipMs}ms  lead evicted ${r.shortfallMs}ms`,
    );
    console.log(`          worklet  ${r.wk ? `calls ${r.wk.calls}  maxGap ${r.wk.maxGapMs}ms  missing ${r.wk.missingMs}ms` : "no data"}`);
    console.log(`          heard    "${r.heard.slice(0, 84)}"`);
    if (r.sp.gaps?.length) {
      for (const g of r.sp.gaps.slice(0, 4)) {
        console.log(`          gap      at ${g.atMs}ms  audio ${g.audioGapMs}ms  wall ${g.wallGapMs}ms  lost ${g.lostMs}ms`);
      }
    }
  }
}

const bad = rows.filter((r) => !r.kept);
const good = rows.filter((r) => r.kept);
const avg = (list, pick) => (list.length ? Math.round(list.reduce((n, r) => n + (pick(r) ?? 0), 0) / list.length) : 0);

console.log(`\n${"=".repeat(104)}`);
console.log("CHAIN CORRELATION  (does a callback gap explain the lost onset?)");
console.log("=".repeat(104));
console.log(`  utterances                     ${rows.length}   first word lost in ${bad.length}`);
console.log(`  ScriptProcessor missing PCM    lost-onset ${avg(bad, (r) => r.sp.missingMs)}ms   intact ${avg(good, (r) => r.sp.missingMs)}ms`);
console.log(`  largest audio-clock gap        lost-onset ${avg(bad, (r) => r.sp.maxAudioGapMs)}ms   intact ${avg(good, (r) => r.sp.maxAudioGapMs)}ms`);
console.log(`  largest wall-clock gap         lost-onset ${avg(bad, (r) => r.sp.maxWallGapMs)}ms   intact ${avg(good, (r) => r.sp.maxWallGapMs)}ms`);
console.log(`  shadow worklet missing         lost-onset ${avg(bad, (r) => r.wk?.missingMs)}ms   intact ${avg(good, (r) => r.wk?.missingMs)}ms`);
console.log(`  shadow worklet largest gap     lost-onset ${avg(bad, (r) => r.wk?.maxGapMs)}ms   intact ${avg(good, (r) => r.wk?.maxGapMs)}ms`);
console.log(`  VAD open offset                lost-onset ${avg(bad, (r) => r.vadOffsetMs)}ms   intact ${avg(good, (r) => r.vadOffsetMs)}ms`);
console.log(`  lead evicted from ring         lost-onset ${avg(bad, (r) => r.shortfallMs)}ms   intact ${avg(good, (r) => r.shortfallMs)}ms`);

// The population question: is there still a second cluster at 1s or beyond?
const opens = rows.map((r) => r.vadOffsetMs ?? 0).sort((a, b) => a - b);
const slow = opens.filter((ms) => ms >= 1000);
console.log(`\nVAD OPEN DISTRIBUTION`);
console.log(`  min ${opens[0]}ms   median ${opens[Math.floor(opens.length / 2)]}ms   max ${opens.at(-1)}ms`);
console.log(`  opens at or beyond 1000ms      ${slow.length}/${rows.length}  ${slow.length ? "SECOND CLUSTER REMAINS" : "single population"}`);
console.log(`  first word preserved           ${good.length}/${rows.length}`);
console.log(`  lead evicted anywhere          ${rows.filter((r) => (r.shortfallMs ?? 0) > 0).length}/${rows.length}`);
console.log(`  internal splits                ${rows.reduce((n, r) => n + (r.splits ?? 0), 0)}  (must be 0)`);
console.log(`  fragments dropped              ${rows.reduce((n, r) => n + (r.drops ?? 0), 0)}  (must be 0)`);
console.log(`  fragments held for merge       ${rows.reduce((n, r) => n + (r.held ?? 0), 0)}`);

const under = rows.filter((r) => r.retainedMs !== null && r.retainedMs < r.requestedMs);
console.log(`\nPRE-ROLL CONTRACT  ${under.length === 0 ? "HELD" : `VIOLATED in ${under.length}/${rows.length}`}`);
console.log(`  requested ${rows[0]?.requestedMs}ms   retained ${rows[0]?.retainedMs}ms`);

// The VAD timeline for the worst late open: was energy above the bar earlier?
const late = [...rows].sort((a, b) => (b.vadOffsetMs ?? 0) - (a.vadOffsetMs ?? 0))[0];
if (late?.vadTimeline?.length) {
  // The mark is written before the transition, so the opening frame is the first
  // voiced frame still labelled idle — not the first frame labelled active.
  const openIdx = late.vadTimeline.findIndex((f) => f.voiced && f.mode === "idle");
  console.log(`\nVAD TIMELINE  [${late.id}]  vadOpen +${late.vadOffsetMs}ms  first word ${late.kept ? "kept" : "LOST"}`);
  console.log("  (negative offsets are before playback started)");
  console.log("      at      level      gate     floor   snr   voiced  mode");
  late.vadTimeline.slice(0, 26).forEach((f, i) => {
    console.log(
      `  ${String(f.atMs).padStart(6)}ms  ${f.level.toFixed(5)}  ${f.gate.toFixed(5)}  ` +
        `${f.floor.toFixed(5)}  ${f.snr.toFixed(1).padStart(5)}  ${f.voiced ? "YES   " : "no    "}  ` +
        `${f.mode}${i === openIdx ? "   <- VAD OPEN" : ""}`,
    );
  });
  const before = openIdx < 0 ? late.vadTimeline : late.vadTimeline.slice(0, openIdx);
  const crossedEarly = before.filter((f) => f.voiced);
  console.log(
    `\n  WAS ENERGY ABOVE THE OPEN THRESHOLD BEFORE VAD OPENED?  ` +
      `${crossedEarly.length ? `YES in ${crossedEarly.length} frame(s) -> CASE 1, state machine` : "NO -> CASE 2, threshold/energy model"}`,
  );
  const speech = before.filter((f) => f.atMs >= 0);
  const peak = speech.reduce((m, f) => Math.max(m, f.level), 0);
  const bar = before.length ? before[before.length - 1].gate : 0;
  console.log(`  peak level before open ${peak.toFixed(5)}   bar at open ${bar.toFixed(5)}`);
  const quiet = late.vadTimeline.filter((f) => f.atMs < 0);
  console.log(
    `  floor during pre-playback silence ${quiet.map((f) => f.floor.toFixed(4)).join(" ") || "n/a"}`,
  );
  console.log(
    `  floor on the first speech frame   ${speech[0] ? speech[0].floor.toFixed(5) : "n/a"}` +
      `  (level ${speech[0] ? speech[0].level.toFixed(5) : "n/a"})`,
  );
}

const spLoses = avg(bad, (r) => r.sp.missingMs);
const wkLoses = avg(bad, (r) => r.wk?.missingMs);
console.log(`\nVERDICT`);
if (!rows.some((r) => r.wk)) {
  console.log("  INCONCLUSIVE — the shadow worklet produced no data.");
} else if (spLoses > 200 && wkLoses < spLoses / 3) {
  console.log("  ScriptProcessorNode loses PCM that the audio thread still received.");
  console.log("  AudioWorklet migration is justified by evidence.");
} else if (spLoses <= 200) {
  console.log("  ScriptProcessorNode is NOT dropping meaningful PCM. The loss is upstream;");
  console.log("  AudioWorklet is not the fix.");
} else {
  console.log("  Both paths lose comparable audio. The loss is upstream of the capture");
  console.log("  boundary; AudioWorklet is not the fix.");
}

await browser.close();
