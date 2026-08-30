#!/usr/bin/env node
/**
 * End-to-end validation of the GROUND product loop.
 *
 * Real speech (macOS `say`) is fed into the app at the getUserMedia /
 * getDisplayMedia boundary, so everything downstream runs for real: the two
 * audio lanes, VAD, the Whisper worker, cleanCaption, the question gate,
 * retrieval, and the Card. Browser SpeechRecognition is disabled so the local
 * path — the one that must work without any external service — is what gets
 * measured.
 *
 * What is NOT covered: the OS-level tab-capture handshake itself, and folder
 * loading with directory structure (Playwright cannot set webkitRelativePath).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const target = process.env.QA_URL || "http://127.0.0.1:8080/app";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const AUDIO = `${ROOT}.qa-audio/`;
const SHOTS = `${ROOT}screenshots/`;
const VOICE = process.env.QA_VOICE || "Samantha";
mkdirSync(AUDIO, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const MODE = process.argv[2] === "real" ? "real" : "demo";

/**
 * Build a RepoPack from this repo's real source. No commits — which matches
 * what the folder loader actually produces, since a picked directory carries
 * no git history.
 */
function realPack() {
  const list = readdirSync(`${ROOT}src`, { recursive: true, encoding: "utf8" })
    .map((rel) => `src/${rel}`)
    .filter((p) => /\.(ts|tsx|css)$/.test(p) && !/\.test\.ts$/.test(p))
    .concat("public/ground-asr-worker.js")
    .filter((p) => statSync(`${ROOT}${p}`).isFile());

  const files = list.slice(0, 160).map((path) => ({
    path,
    language: path.split(".").pop(),
    content: readFileSync(`${ROOT}${path}`, "utf8").slice(0, 80_000),
  }));

  return {
    id: "group-copilot-real",
    name: "group-copilot",
    description: "GROUND itself — real source, loaded the way a folder loads.",
    files,
    commits: [],
  };
}

/** lane: "computer" = the other person, "mic" = me. */
const DEMO_SCRIPT = [
  // Chatter before any Card exists.
  { id: "c1", lane: "computer", text: "Can you hear me okay?", expect: "silent" },
  { id: "c2", lane: "computer", text: "Can everyone see my screen?", expect: "silent" },
  { id: "c3", lane: "computer", text: "Should we move on?", expect: "silent" },

  // Real questions about the loaded material.
  { id: "q1", lane: "computer", text: "Why does that retry three times?", expect: "card", cite: "src/exporter/retry.ts" },
  { id: "q2", lane: "computer", text: "Who touched the auth flow?", expect: "card", cite: "src/auth" },
  { id: "q3", lane: "computer", text: "What did we change in the exporter?", expect: "card", cite: "src/exporter" },

  // Chatter again, now that a cited Card is on screen (threadOpen is true).
  { id: "c4", lane: "computer", text: "Any questions?", expect: "silent" },
  { id: "c5", lane: "computer", text: "Are we good?", expect: "silent" },

  // My own voice must never open a Card.
  { id: "m1", lane: "mic", text: "Why does that retry three times?", expect: "silent" },
];

/** Same loop against real material, where no scripted demo branch can fire. */
const REAL_SCRIPT = [
  { id: "rc1", lane: "computer", text: "Can you hear me okay?", expect: "silent" },
  { id: "rc2", lane: "computer", text: "Should we move on?", expect: "silent" },

  { id: "r1", lane: "computer", text: "How does the question gate work?", expect: "card", cite: "question.ts" },
  { id: "r2", lane: "computer", text: "Where do we handle the audio lanes?", expect: "card", cite: "call-share.ts" },
  { id: "r3", lane: "computer", text: "How does retrieval score the chunks?", expect: "card", cite: "retrieve.ts" },

  { id: "rc3", lane: "computer", text: "Any questions?", expect: "silent" },
  { id: "m2", lane: "mic", text: "How does the question gate work?", expect: "silent" },
];

const SCRIPT = MODE === "real" ? REAL_SCRIPT : DEMO_SCRIPT;
// Deliberately a query nothing in the spoken script asked, so a matching
// existing Card cannot make a broken Search look like it worked.
const MANUAL = MODE === "real" ? "What does clean caption strip out?" : "What did we change in the exporter?";

function wav(id, text) {
  const out = `${AUDIO}${id}.wav`;
  if (existsSync(out)) return out;
  const aiff = `${AUDIO}${id}.aiff`;
  try {
    execFileSync("say", ["-v", VOICE, "-o", aiff, text]);
  } catch {
    execFileSync("say", ["-o", aiff, text]);
  }
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@48000", "-c", "1", aiff, out]);
  return out;
}

function words(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/).filter(Boolean);
}

/** Word error rate of `got` against `want`. */
function wer(want, got) {
  const a = words(want);
  const b = words(got);
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return d[a.length][b.length] / a.length;
}

const browser = await chromium.launch({
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

if (MODE === "real") {
  const pack = realPack();
  console.log(
    `Seeding real material: ${pack.name} — ${pack.files.length} files, ${pack.commits.length} commits`,
  );
  await context.addInitScript((wire) => {
    localStorage.setItem("ground.pack", wire);
  }, JSON.stringify(pack));
}

await context.addInitScript(() => {
  // Force the local path: no browser SpeechRecognition.
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
    src.start();
    return audio.duration * 1000;
  };

  navigator.mediaDevices.getUserMedia = async () => lane("mic").dest.stream;
  navigator.mediaDevices.getDisplayMedia = async () => lane("computer").dest.stream;
});

const page = await context.newPage();
const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(String(e)));

const room = page.locator('[data-pane="room"]');
const card = page.locator('[data-pane="card"]');
const sayEl = card.locator("p.font-serif.text-fg").first();

async function readState() {
  const say = (await sayEl.count()) ? (await sayEl.innerText()).trim() : "";
  const citeBtns = card.locator("button:has(span.font-mono)");
  const nCites = await citeBtns.count();
  const cite = nCites ? (await citeBtns.first().innerText()).trim() : "";
  const allCites = nCites ? (await citeBtns.allInnerTexts()).map((t) => t.replace(/\n/g, " ").trim()) : [];
  const you = (await room.locator("p.text-faint").count())
    ? (await room.locator("p.text-faint").first().innerText()).trim()
    : "";
  const badge = (await card.locator(".ground-hint").first().innerText()).trim();
  const transcript = (await room.locator("p.ground-transcript").count())
    ? (await room.locator("p.ground-transcript").innerText()).trim()
    : "";
  return { say, cite, allCites, nCites, you, badge, transcript };
}

console.log(`Loading ${target}`);
await page.goto(target, { waitUntil: "networkidle", timeout: 60000 });

// The Whisper model loads on mount. Wait for the note to appear before timing
// it, otherwise we race the mount and record a meaningless zero.
const warmStart = Date.now();
let sawNote = false;
let warmed = false;
for (let i = 0; i < 400; i += 1) {
  const text = await room.innerText();
  const busy = /Downloading captions|Loading captions|Starting captions/i.test(text);
  if (busy) sawNote = true;
  if (sawNote && !busy) {
    warmed = true;
    break;
  }
  if (!sawNote && Date.now() - warmStart > 8000) break;
  await page.waitForTimeout(250);
}
const warmMs = Date.now() - warmStart;
const warmLabel = warmed
  ? `${(warmMs / 1000).toFixed(1)}s`
  : sawNote
    ? "TIMED OUT"
    : "note never appeared (cached or already warm)";
console.log(`ASR warmup: ${warmLabel}\n`);

await page.getByRole("button", { name: /^Listen$/i }).click();
await page.waitForTimeout(2500);
const afterListen = await room.innerText();
console.log(`Listen state: ${afterListen.split("\n").slice(-2).join(" | ").slice(0, 120)}\n`);

const rows = [];
for (const clip of SCRIPT) {
  const b64 = readFileSync(wav(clip.id, clip.text)).toString("base64");
  const before = await readState();

  const playedAt = Date.now();
  const durMs = await page.evaluate(
    ([name, data]) => window.__groundPlay(name, data),
    [clip.lane, b64],
  );
  const endsAt = playedAt + durMs;

  const budget = clip.expect === "card" ? 20000 : 9000;
  let cardAt = null;
  let state = before;
  while (Date.now() - endsAt < budget) {
    state = await readState();
    if (state.say && state.say !== before.say) {
      cardAt = Date.now();
      break;
    }
    await page.waitForTimeout(120);
  }
  if (!cardAt) state = await readState();

  const heardDelta = state.transcript.startsWith(before.transcript)
    ? state.transcript.slice(before.transcript.length).trim()
    : state.transcript;

  rows.push({
    id: clip.id,
    lane: clip.lane,
    text: clip.text,
    expect: clip.expect,
    want: clip.cite ?? null,
    durMs: Math.round(durMs),
    heard: heardDelta,
    werPct: heardDelta ? Math.round(wer(clip.text, heardDelta) * 100) : null,
    say: state.say,
    citeGot: state.cite,
    badge: state.badge,
    fired: Boolean(cardAt),
    latencyMs: cardAt ? cardAt - endsAt : null,
  });

  const label = clip.expect === "card" ? "expect CARD  " : "expect SILENCE";
  console.log(`[${clip.id}] ${label} lane=${clip.lane}  "${clip.text}"`);
  console.log(`      heard: ${heardDelta ? `"${heardDelta}"` : "(nothing)"}${rows.at(-1).werPct != null ? `  WER ${rows.at(-1).werPct}%` : ""}`);
  console.log(
    `      card:  ${cardAt ? `+${cardAt - endsAt}ms  "${state.say.slice(0, 70)}"` : "none"}`,
  );
  if (cardAt) console.log(`      cite:  ${state.nCites} chip(s) → ${state.allCites.join("  ·  ").slice(0, 120)}`);
  if (clip.lane === "mic") console.log(`      you:   ${state.you ? `"${state.you}"` : "(no You line — mic produced nothing)"}`);
  console.log("");

  // Let the thread settle between utterances.
  await page.waitForTimeout(1200);
}

// Manual Search must work regardless of audio.
const beforeManual = await readState();
await page.locator("textarea.ground-question").fill(MANUAL);
await page.keyboard.press("Enter");
await page.waitForTimeout(2500);
const manual = await readState();
const manualOk = Boolean(manual.say) && manual.say !== beforeManual.say;
console.log(`\nMANUAL SEARCH  "${MANUAL}"`);
console.log(`  before: "${beforeManual.say.slice(0, 60)}"`);
console.log(`  after:  "${manual.say.slice(0, 60)}"`);
console.log(`  cite:   ${manual.allCites.join("  ·  ").slice(0, 100)}\n`);

await page.screenshot({ path: `${SHOTS}loop-${MODE}.png` });

console.log("=".repeat(72));
console.log("SUMMARY");
console.log("=".repeat(72));

const asked = rows.filter((r) => r.expect === "card");
const quiet = rows.filter((r) => r.expect === "silent");
const heardAny = rows.filter((r) => r.heard);
const wers = heardAny.filter((r) => r.werPct != null).map((r) => r.werPct);
const latencies = asked.filter((r) => r.latencyMs != null).map((r) => r.latencyMs);

console.log(`transcription:      ${heardAny.length}/${rows.length} utterances produced text`);
console.log(
  `  word error rate:  ${wers.length ? `median ${wers.sort((a, b) => a - b)[Math.floor(wers.length / 2)]}%  (${wers.join("%, ")}%)` : "n/a"}`,
);
console.log(`question detection: ${asked.filter((r) => r.fired).length}/${asked.length} real questions produced a Card`);
console.log(`false triggers:     ${quiet.filter((r) => r.fired).length}/${quiet.length} chatter/own-voice clips wrongly produced a Card`);
const citedRight = asked.filter((r) => r.fired && r.want && r.citeGot.includes(r.want));
console.log(`citations correct:  ${citedRight.length}/${asked.filter((r) => r.fired).length} of fired Cards`);
console.log(
  `latency (end→Card): ${latencies.length ? `${Math.min(...latencies)}–${Math.max(...latencies)}ms, median ${latencies.sort((a, b) => a - b)[Math.floor(latencies.length / 2)]}ms` : "n/a"}`,
);
console.log(`manual Search:      ${manualOk ? "works" : "BROKEN"}`);
console.log(`console errors:     ${consoleErrors.length}${consoleErrors.length ? ` — ${consoleErrors.slice(0, 3).join(" | ").slice(0, 200)}` : ""}`);
console.log(`ASR warmup:         ${warmLabel}`);
console.log(`material:           ${MODE === "real" ? "real repo (group-copilot source + git log)" : "demo pack (northstar-payments)"}`);
console.log(`card source badges: ${asked.filter((r) => r.fired).map((r) => r.badge.replace(/\n/g, " ")).join("  |  ") || "n/a"}`);

console.log("\nPER-QUESTION CITATION CHECK");
for (const r of asked) {
  const pass = r.fired && r.want && r.citeGot.includes(r.want);
  console.log(
    `  ${pass ? "OK  " : "MISS"} [${r.id}] want ${r.want} · got ${r.citeGot.split("\n")[0] || "(no card)"}`,
  );
}

console.log("\nFALSE TRIGGERS");
const bad = quiet.filter((r) => r.fired);
if (bad.length === 0) console.log("  none");
for (const r of bad) {
  console.log(`  [${r.id}] lane=${r.lane} "${r.text}" → "${r.say.slice(0, 60)}"`);
}

await browser.close();
