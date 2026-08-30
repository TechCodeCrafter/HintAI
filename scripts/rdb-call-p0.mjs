#!/usr/bin/env node
/**
 * Real-call P0 test against the loaded rdb-labsai-backend.
 *
 * Every question arrives on the shared-tab CALL lane (getDisplayMedia), spoken
 * by a different voice than the mic lane — "the other person". Real speech from
 * macOS `say` enters at the media boundary, so the two lanes, VAD, the Whisper
 * worker, cleanCaption, the question gate, retrieval and Card composition all
 * run for real. Browser SpeechRecognition is disabled so the local path is what
 * gets measured.
 *
 * Beyond the older loop harness this also checks requirement 8: whether the
 * citation supports the ENTIRE spoken claim, word by word.
 *
 * node --experimental-strip-types scripts/rdb-dryrun.ts   # writes /tmp/rdb-pack.json
 * node scripts/rdb-call-p0.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const target = process.env.QA_URL || "http://127.0.0.1:8080/app";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const AUDIO = `${ROOT}.qa-audio/call-p0/`;
const SHOTS = `${ROOT}screenshots/`;
mkdirSync(AUDIO, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

// The other person and I must not sound the same.
const THEM_VOICE = process.env.QA_THEM || "Daniel";
const ME_VOICE = process.env.QA_ME || "Samantha";

const pack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));
const fileText = new Map(pack.files.map((f) => [f.path, f.content]));

/**
 * lane "computer" = the other person over the shared tab. lane "mic" = me.
 * `cite` is the path fragment the answer must be grounded in.
 */
const SCRIPT = [
  // --- chatter before any Card exists ---
  { id: "c1", lane: "computer", text: "Can you hear me okay?", expect: "silent", kind: "chatter" },
  { id: "c2", lane: "computer", text: "Can everyone see my screen?", expect: "silent", kind: "chatter" },

  // --- what does X do ---
  {
    id: "q1",
    lane: "computer",
    text: "What does the BDA ingest worker do?",
    expect: "card",
    kind: "what does X do",
    cite: "bda-ingest-worker",
  },

  // --- how does X work ---
  {
    id: "q2",
    lane: "computer",
    text: "How does the Excel export work?",
    expect: "card",
    kind: "how does X work",
    cite: "excel_output_generator",
  },

  // --- chatter once a Card is on screen ---
  { id: "c3", lane: "computer", text: "Should we move on?", expect: "silent", kind: "chatter" },
  { id: "c4", lane: "computer", text: "Sorry, can you repeat that?", expect: "silent", kind: "chatter" },

  // --- where does X happen ---
  {
    id: "q3",
    lane: "computer",
    text: "Where does document upload happen?",
    expect: "card",
    kind: "where does X happen",
    cite: "upload",
  },

  // --- why is X done this way, asked naturally with a preamble ---
  {
    id: "q4",
    lane: "computer",
    text: "Okay so why is the extraction done in a container lambda?",
    expect: "card",
    kind: "why is X done this way",
    cite: "extraction|iceberg|container-lambdas",
  },

  // --- one more natural question ---
  {
    id: "q5",
    lane: "computer",
    text: "And how is the data indexed for RAG?",
    expect: "card",
    kind: "how does X work",
    cite: "global-rag-indexer",
  },

  // --- more chatter ---
  { id: "c5", lane: "computer", text: "Any questions?", expect: "silent", kind: "chatter" },
  { id: "c6", lane: "computer", text: "Are we good on time?", expect: "silent", kind: "chatter" },

  // --- my own voice must never open a Card ---
  {
    id: "m1",
    lane: "mic",
    text: "How does the Excel export work?",
    expect: "silent",
    kind: "own voice",
  },
];

// A query nothing spoken asked, so an existing Card cannot fake a working Search.
const MANUAL = "What does the admin router expose?";

function wav(id, text, voice) {
  const out = `${AUDIO}${id}.wav`;
  if (existsSync(out)) return out;
  const aiff = `${AUDIO}${id}.aiff`;
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
  if (a.length === 0) return b.length === 0 ? 0 : 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length] / a.length;
}

const GLUE = new Set([
  "this","that","with","from","into","also","when","which","where","their","them","there","then",
  "have","been","being","does","service","split","across","work","plus","more","other","using",
  "rdb-labsai-backend","fastapi",
]);

/**
 * Requirement 8: does the cited evidence support the whole claim? Every content
 * word of the spoken line should appear in one of the cited files.
 */
function claimSupport(say, citePaths) {
  const corpus = citePaths.map((p) => fileText.get(p) ?? "").join("\n").toLowerCase();
  if (!corpus.trim()) return { ok: false, missing: ["(cited file not in pack)"], checked: 0 };
  const content = [
    ...new Set(
      say
        .toLowerCase()
        .split(/\s+/)
        // Strip surrounding punctuation so "files." is compared as "files".
        .map((w) => w.replace(/^[^a-z0-9_]+/, "").replace(/[^a-z0-9_]+$/, ""))
        .filter((w) => w.length > 4 && !GLUE.has(w)),
    ),
  ];
  const missing = content.filter((w) => !corpus.includes(w));
  return { ok: missing.length === 0, missing, checked: content.length };
}

const browser = await chromium.launch({
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

await context.addInitScript((wire) => localStorage.setItem("ground.pack", wire), JSON.stringify(pack));
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

async function readState() {
  const say = (await sayEl.count()) ? (await sayEl.innerText()).trim() : "";
  const citeBtns = card.locator("button:has(span.font-mono)");
  const n = await citeBtns.count();
  const allCites = n ? (await citeBtns.allInnerTexts()).map((t) => t.replace(/\s+/g, "").trim()) : [];
  const heard = (await card.locator("p.font-serif").count()) > 1
    ? (await card.locator("p.font-serif").first().innerText()).trim()
    : "";
  const transcript = (await room.locator("p.ground-transcript").count())
    ? (await room.locator("p.ground-transcript").innerText()).trim()
    : "";
  const badge = (await card.locator(".ground-hint").first().innerText()).trim();
  return { say, allCites, nCites: n, heard, transcript, badge };
}

console.log(`Material: ${pack.name} — ${pack.files.length} files, ${pack.commits.length} commits`);
console.log(`Voices:   them=${THEM_VOICE}  me=${ME_VOICE}`);
console.log(`Loading ${target}\n`);
await page.goto(target, { waitUntil: "networkidle", timeout: 60000 });

// Warm the Whisper model before timing anything.
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
const warmLabel = warmed ? `${((Date.now() - warmStart) / 1000).toFixed(1)}s` : sawNote ? "TIMED OUT" : "already warm";
console.log(`ASR warmup: ${warmLabel}`);

// Listen opens BOTH lanes in one step: startHear() calls getUserMedia and
// getDisplayMedia together, so this is the shared-tab call lane path.
await page.getByRole("button", { name: /^Listen$/i }).click();
await page.waitForTimeout(2500);
const roomText = await room.innerText();
const noteLine = roomText.split("\n").find((l) => /lanes?|shared tab|call tab/i.test(l)) ?? "";
const twoLanes = /separate lanes/i.test(roomText);
console.log(`Call lane: ${twoLanes ? "CALL + MIC are separate lanes" : "MIC ONLY — not a call-lane test"}`);
console.log(`Room note: ${noteLine.trim().slice(0, 160)}\n`);
console.log("=".repeat(78));

const rows = [];
for (const clip of SCRIPT) {
  const voice = clip.lane === "mic" ? ME_VOICE : THEM_VOICE;
  const b64 = readFileSync(wav(clip.id, clip.text, voice)).toString("base64");
  const before = await readState();

  const playedAt = Date.now();
  const durMs = await page.evaluate(([name, data]) => window.__groundPlay(name, data), [clip.lane, b64]);
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

  const citePaths = state.allCites.map((c) => c.replace(/:\d+$/, ""));
  const support = cardAt && state.say ? claimSupport(state.say, citePaths) : null;
  const citeOk = clip.cite ? citePaths.some((p) => new RegExp(clip.cite).test(p)) : null;

  rows.push({
    ...clip,
    durMs: Math.round(durMs),
    heard: heardDelta,
    werPct: heardDelta ? Math.round(wer(clip.text, heardDelta) * 100) : null,
    say: state.say,
    heardBox: state.heard,
    citePaths,
    citeOk,
    support,
    fired: Boolean(cardAt),
    latencyMs: cardAt ? cardAt - endsAt : null,
    badge: state.badge,
  });

  const r = rows.at(-1);
  console.log(`\n[${clip.id}] ${clip.kind.toUpperCase()}  lane=${clip.lane}  expect ${clip.expect.toUpperCase()}`);
  console.log(`   asked   "${clip.text}"`);
  console.log(`   heard   ${heardDelta ? `"${heardDelta}"  WER ${r.werPct}%` : "(nothing)"}`);
  console.log(`   card    ${cardAt ? `+${r.latencyMs}ms` : "none"}`);
  if (cardAt) {
    console.log(`   say     ${state.say}`);
    console.log(`   cite    ${state.allCites.join("  ·  ")}`);
    console.log(`   cite ok ${citeOk === null ? "n/a" : citeOk ? "yes" : `NO — wanted /${clip.cite}/`}`);
    console.log(
      `   support ${support.ok ? `yes — all ${support.checked} content words in cited file(s)` : `NO — not in cited file(s): ${support.missing.join(", ")}`}`,
    );
  }

  // People pause between sentences. Without this the tail of one utterance
  // bleeds into the next and the harness, not the app, clips the onset.
  await page.waitForTimeout(1800);
}

// Manual Search fallback.
const beforeManual = await readState();
await page.locator("textarea.ground-question").fill(MANUAL);
await page.keyboard.press("Enter");
await page.waitForTimeout(3000);
const manual = await readState();
const manualOk = Boolean(manual.say) && manual.say !== beforeManual.say;
console.log(`\n${"=".repeat(78)}`);
console.log(`MANUAL SEARCH  "${MANUAL}"`);
console.log(`   say     ${manual.say || "(silent)"}`);
console.log(`   cite    ${manual.allCites.join("  ·  ")}`);
console.log(`   status  ${manualOk ? "works" : "BROKEN — no new Card"}`);

await page.screenshot({ path: `${SHOTS}call-p0.png` });

const asked = rows.filter((r) => r.expect === "card");
const quiet = rows.filter((r) => r.expect === "silent");
const fired = asked.filter((r) => r.fired);
const lat = fired.filter((r) => r.latencyMs != null).map((r) => r.latencyMs).sort((a, b) => a - b);
const wers = rows.filter((r) => r.werPct != null).map((r) => r.werPct).sort((a, b) => a - b);

console.log(`\n${"=".repeat(78)}`);
console.log("SUMMARY");
console.log("=".repeat(78));
console.log(`heard the question:   ${asked.filter((r) => r.heard).length}/${asked.length}`);
console.log(`  WER median:         ${wers.length ? `${wers[Math.floor(wers.length / 2)]}%  (${wers.join("%, ")}%)` : "n/a"}`);
console.log(`Card fired:           ${fired.length}/${asked.length}`);
console.log(`false triggers:       ${quiet.filter((r) => r.fired).length}/${quiet.length}`);
console.log(`citation on target:   ${fired.filter((r) => r.citeOk).length}/${fired.length}`);
console.log(`claim fully supported:${fired.filter((r) => r.support?.ok).length}/${fired.length}`);
console.log(`latency end→Card:     ${lat.length ? `${lat[0]}–${lat.at(-1)}ms, median ${lat[Math.floor(lat.length / 2)]}ms` : "n/a"}`);
console.log(`manual Search:        ${manualOk ? "works" : "BROKEN"}`);
console.log(`console errors:       ${consoleErrors.length}${consoleErrors.length ? ` — ${consoleErrors.slice(0, 2).join(" | ").slice(0, 160)}` : ""}`);

console.log("\nBY QUESTION SHAPE");
for (const r of asked) {
  const verdict = !r.fired ? "NO CARD" : !r.citeOk ? "WRONG CITE" : !r.support?.ok ? "UNSUPPORTED" : "OK";
  console.log(`  ${verdict.padEnd(11)} [${r.id}] ${r.kind.padEnd(24)} ${r.latencyMs != null ? `${r.latencyMs}ms` : "-"}`);
}
console.log("\nFALSE TRIGGERS");
const bad = quiet.filter((r) => r.fired);
if (!bad.length) console.log("  none");
for (const r of bad) console.log(`  [${r.id}] "${r.text}" → "${r.say.slice(0, 70)}"`);

await browser.close();
