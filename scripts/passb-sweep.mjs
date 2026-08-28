#!/usr/bin/env node
/**
 * Pass B acceptance sweep on the shared-tab CALL lane.
 *
 * One pre-roll configuration per invocation:
 *   node scripts/passb-sweep.mjs <preRollMs> [reps]
 *
 * Byte-identical audio enters at the getDisplayMedia boundary, so the two
 * lanes, VAD, segmentation, Whisper, the gate, retrieval and the Card all run
 * for real. The heavy probe work is disabled so instrumentation does not
 * distort the audio callback's timing.
 *
 * The Card is cleared before every attempt with a query that matches nothing.
 * Without that, a repeat of identical audio produces an identical Card and a
 * DOM diff cannot tell that a second one fired.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const target = process.env.QA_URL || "http://127.0.0.1:8080/";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const AUDIO = `${ROOT}.qa-audio/passb/`;
const OUT = `${ROOT}screenshots/passb/`;
mkdirSync(AUDIO, { recursive: true });
mkdirSync(OUT, { recursive: true });

const PRE_ROLL = Number(process.argv[2] ?? 500);
const REPS = Number(process.argv[3] ?? 3);
const HANGOVER = Number(process.env.QA_HANGOVER ?? 900);
const THEM = process.env.QA_THEM || "Daniel";
const ME = process.env.QA_ME || "Samantha";
/** Matches nothing in the pack, so the Card goes silent between attempts. */
const CLEAR_QUERY = "zzqqxx nothing matches this";

const pack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));
const fileText = new Map(pack.files.map((f) => [f.path, f.content]));

const QUESTIONS = [
  { id: "q1", shape: "what does X do", text: "What does the BDA ingest worker do?", cite: "bda-ingest-worker" },
  { id: "q2", shape: "how does X work", text: "How does the Excel export work?", cite: "excel_output_generator" },
  { id: "q3", shape: "where does X happen", text: "Where does document upload happen?", cite: "upload" },
  { id: "q4", shape: "why is X done this way", text: "Why is the extraction done in a container lambda?", cite: "container-lambdas|iceberg|extraction" },
  { id: "q5", shape: "how is X done", text: "How is the data indexed for RAG?", cite: "global-rag" },
];
// `[[slnc N]]` inserts a real pause, testing that a natural intra-sentence gap
// no longer splits one question into discarded fragments.
const PAUSED = [
  { id: "p3", shape: "paused: where", text: "Where does document [[slnc 600]] upload happen?", clean: "Where does document upload happen?", cite: "upload" },
  { id: "p4", shape: "paused: why", text: "Why is the extraction [[slnc 600]] done in a container lambda?", clean: "Why is the extraction done in a container lambda?", cite: "container-lambdas|iceberg|extraction" },
];
const CHATTER = [
  "Can you hear me?",
  "Can everyone see my screen?",
  "Should we move on?",
  "Sorry, can you repeat that?",
  "Any questions?",
  "Are we good on time?",
].map((text, i) => ({ id: `c${i}`, shape: "chatter", text }));

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
/** The defect under test: did the opening interrogative survive? */
function keptOpening(want, got) {
  const a = words(want);
  const b = words(got);
  if (!a.length || !b.length) return false;
  return b.indexOf(a[0]) >= 0 && b.indexOf(a[0]) <= 1;
}

const GLUE = new Set([
  "this","that","with","from","into","also","when","which","where","their","them","there","then",
  "have","been","being","does","service","split","across","work","plus","more","other","using",
  "rdb-labsai-backend","fastapi",
]);
function claimSupport(say, citePaths) {
  const corpus = citePaths.map((p) => fileText.get(p) ?? "").join("\n").toLowerCase();
  if (!corpus.trim()) return { ok: false, missing: ["(cited file absent)"] };
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
  ([preRollMs, hangoverMs]) => {
    window.__GROUND_PROBE__ = true;
    // Final numbers must reflect normal runtime, so the expensive envelope and
    // WAV capture stay off during acceptance.
    window.__GROUND_PROBE_LIGHT__ = true;
    window.__GROUND_TUNING__ = { preRollMs, hangoverMs };
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
      // never counted as a late VAD open.
      window.__groundProbe?.reset();
      src.start();
      return { durMs: audio.duration * 1000, startedAt: Date.now() };
    };
    navigator.mediaDevices.getUserMedia = async () => lane("mic").dest.stream;
    navigator.mediaDevices.getDisplayMedia = async () => lane("computer").dest.stream;
  },
  [PRE_ROLL, HANGOVER],
);

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

async function clearCard() {
  await page.locator("textarea.ground-question").fill(CLEAR_QUERY);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  await page.locator("textarea.ground-question").fill("");
  // Focus must leave the box: the store suppresses auto-answer while a textarea
  // is focused (isTyping), so leaving it focused silently kills every spoken
  // question that follows.
  await page.evaluate(() => document.activeElement?.blur?.());
  return (await readCard()).say;
}

await page.goto(target, { waitUntil: "domcontentloaded", timeout: 60000 });
await room.waitFor({ state: "visible", timeout: 60000 });
for (let i = 0; i < 400; i += 1) {
  const text = await room.innerText();
  if (i > 4 && !/Downloading captions|Loading captions|Starting captions/i.test(text)) break;
  await page.waitForTimeout(250);
}
await page.getByRole("button", { name: /^Listen$/i }).click();
await page.waitForTimeout(2500);
const roomText = await room.innerText();
const twoLanes = /separate lanes/i.test(roomText);
console.log(`CONFIG    preRoll=${PRE_ROLL}ms hangover=${HANGOVER}ms reps=${REPS} probe=light`);
console.log(`LANES     ${twoLanes ? "CALL + MIC separate (shared-tab lane live)" : "MIC ONLY — not a call-lane test"}`);
const clearWorks = (await clearCard()) === "";
console.log(`CLEAR     ${clearWorks ? "Card clears between attempts" : "WARNING: clear query left a Card up"}`);
console.log("=".repeat(96));

const rows = [];

async function attempt(item, rep, lane, expectCard) {
  const id = `${item.id}-${rep}`;
  const expected = item.clean ?? item.text;
  const b64 = readFileSync(wav(item.id, item.text, lane === "mic" ? ME : THEM)).toString("base64");

  const baseline = await clearCard();
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

  const { durMs } = await page.evaluate(([n, d]) => window.__groundPlay(n, d), [lane, b64]);
  const endsAt = Date.now() + durMs;

  let fired = false;
  let state = { say: "", cites: [] };
  let cardAt = null;
  let committedAt = null;
  const budget = expectCard ? 20000 : 9000;
  while (Date.now() - endsAt < budget) {
    state = await readCard();
    if (state.say && state.say !== baseline) {
      fired = true;
      cardAt = Date.now();
      break;
    }
    const committed = await page.evaluate(() =>
      (window.__groundProbe?.events() ?? []).some(
        (e) => e.kind === "committed" || e.kind === "utterance-dropped",
      ),
    );
    if (committed) {
      committedAt = committedAt ?? Date.now();
      if (Date.now() - committedAt > 4000) break;
    }
    await page.waitForTimeout(100);
  }

  const probe = await page.evaluate(() => {
    const all = window.__groundProbe?.events() ?? [];
    return {
      events: all.filter((e) => e.kind !== "frame"),
      committed: all.filter((e) => e.kind === "committed").map((e) => e.detail?.text ?? ""),
    };
  });
  const open = probe.events.find((e) => e.kind === "vad-open");
  const ends = probe.events.filter((e) => e.kind === "utterance-end");
  const drops = probe.events.filter((e) => e.kind === "utterance-dropped");
  const held = probe.events.filter((e) => e.kind === "fragment-held");
  const expired = probe.events.filter((e) => e.kind === "fragment-expired");
  const cleaned = probe.events.find((e) => e.kind === "clean-caption");
  const resets = probe.events.filter((e) => e.kind === "lane-reset");
  const heard = probe.committed.join(" ") || cleaned?.detail?.cleaned || "";

  const citePaths = state.cites.map((c) => c.replace(/:\d+$/, ""));
  const support = fired && state.say ? claimSupport(state.say, citePaths) : null;
  const citeOk = item.cite ? citePaths.some((p) => new RegExp(item.cite).test(p)) : null;

  rows.push({
    id,
    shape: item.shape,
    lane,
    expectCard,
    expected,
    sourceMs: Math.round(durMs),
    vadOpenMs: open ? open.t : null,
    preRollSentMs: ends[0]?.detail?.preRollMs ?? null,
    voicedMs: ends[0]?.detail?.voicedMs ?? null,
    splits: Math.max(0, ends.length - 1),
    drops: drops.length,
    held: held.length,
    expired: expired.length,
    resetClean: resets.every((r) => r.detail.pendingFrames === 0 && r.detail.rollMs === 0),
    heard,
    werPct: Math.round(wer(expected, heard) * 100),
    keptOpening: keptOpening(expected, heard),
    say: state.say,
    cites: state.cites,
    citeOk,
    supported: support?.ok ?? null,
    missing: support?.missing ?? [],
    fired,
    latencyMs: cardAt ? cardAt - endsAt : null,
  });

  const r = rows.at(-1);
  console.log(
    `[${id.padEnd(6)}] ${r.shape.padEnd(24)} lane=${lane.padEnd(8)} ` +
      `vad+${String(r.vadOpenMs).padStart(4)}ms preroll ${String(r.preRollSentMs).padStart(4)}ms ` +
      `splits ${r.splits} drops ${r.drops} held ${r.held}`,
  );
  console.log(`          heard  "${r.heard}"  WER ${r.werPct}% first-word ${r.keptOpening ? "kept" : "LOST"}`);
  if (r.fired) {
    console.log(`          card   +${r.latencyMs}ms  "${r.say.slice(0, 78)}"`);
    console.log(`          cite   ${r.cites.join(" · ")}  ${r.citeOk ? "on target" : "OFF TARGET"}  support ${r.supported ? "PASS" : `FAIL(${r.missing.join(",")})`}`);
  } else {
    console.log(
      `          card   none${expectCard ? `  <-- MISSED (baseline "${baseline.slice(0, 40)}")` : "  (correctly silent)"}`,
    );
  }
  await page.waitForTimeout(1500);
}

for (const q of [...QUESTIONS, ...PAUSED]) {
  for (let rep = 1; rep <= REPS; rep += 1) await attempt(q, rep, "computer", true);
}
console.log("-".repeat(96));
for (const c of CHATTER) await attempt(c, 1, "computer", false);
console.log("-".repeat(96));
// The microphone is me: it must never open a Card while a shared tab is live.
await attempt({ id: "mic", shape: "own voice (mic)", text: "How does the Excel export work?" }, 1, "mic", false);

// Manual Search must remain a working fallback.
const beforeManual = await clearCard();
await page.locator("textarea.ground-question").fill("What does the admin router expose?");
await page.keyboard.press("Enter");
await page.waitForTimeout(3000);
const manual = await readCard();
const manualOk = Boolean(manual.say) && manual.say !== beforeManual;

await page.screenshot({ path: `${OUT}passb-${PRE_ROLL}.png` });

const asked = rows.filter((r) => r.expectCard);
const quiet = rows.filter((r) => !r.expectCard);
const lat = asked.filter((r) => r.latencyMs != null).map((r) => r.latencyMs).sort((a, b) => a - b);
const shapes = [...new Set(asked.map((r) => r.shape))];
const shapeOk = shapes.filter((s) => asked.filter((r) => r.shape === s).every((r) => r.keptOpening && r.fired));

console.log(`\n${"=".repeat(96)}`);
console.log(`PASS B RESULTS — preRoll ${PRE_ROLL}ms, hangover ${HANGOVER}ms, ${REPS} reps`);
console.log("=".repeat(96));
console.log(`1  question capture rate      ${asked.filter((r) => r.fired).length}/${asked.length} produced a Card`);
console.log(`2  first word preserved       ${asked.filter((r) => r.keptOpening).length}/${asked.length}   (WER median ${asked.length ? asked.map((r) => r.werPct).sort((a, b) => a - b)[Math.floor(asked.length / 2)] : "-"}%)`);
console.log(`3  VAD open offset            ${asked.length ? `${Math.min(...asked.map((r) => r.vadOpenMs ?? 0))}–${Math.max(...asked.map((r) => r.vadOpenMs ?? 0))}ms` : "-"}`);
console.log(`4  internal splits            ${asked.reduce((n, r) => n + r.splits, 0)}`);
console.log(`5  useful fragments dropped   ${asked.reduce((n, r) => n + r.drops, 0)} dropped, ${asked.reduce((n, r) => n + r.expired, 0)} held-then-expired`);
console.log(`7  cards fired                ${asked.filter((r) => r.fired).length}/${asked.length}`);
console.log(`8  support validator          ${asked.filter((r) => r.supported).length}/${asked.filter((r) => r.fired).length} of fired Cards fully supported`);
console.log(`   citations on target        ${asked.filter((r) => r.citeOk).length}/${asked.filter((r) => r.fired).length}`);
console.log(`9  chatter false triggers     ${quiet.filter((r) => r.lane === "computer" && r.fired).length}/${quiet.filter((r) => r.lane === "computer").length}`);
console.log(`   mic auto-trigger           ${rows.filter((r) => r.lane === "mic" && r.fired).length === 0 ? "none (correct)" : "MIC FIRED A CARD"}`);
console.log(`10 question-end -> Card       ${lat.length ? `${lat[0]}–${lat.at(-1)}ms, median ${lat[Math.floor(lat.length / 2)]}ms` : "n/a"}`);
console.log(`   manual Search             ${manualOk ? "works" : "BROKEN"}`);
console.log(`   lane reset clean          ${asked.every((r) => r.resetClean) ? "yes (no frames retained after commit)" : "NO"}`);
console.log(`   console errors            ${consoleErrors.length}`);

console.log(`\nPER SHAPE (all reps must pass)`);
for (const s of shapes) {
  const g = asked.filter((r) => r.shape === s);
  console.log(
    `  ${shapeOk.includes(s) ? "PASS" : "FAIL"}  ${s.padEnd(24)} ` +
      `card ${g.filter((r) => r.fired).length}/${g.length}  firstword ${g.filter((r) => r.keptOpening).length}/${g.length}  ` +
      `support ${g.filter((r) => r.supported).length}/${g.filter((r) => r.fired).length}`,
  );
}

const pass =
  shapeOk.length === shapes.length &&
  asked.every((r) => r.keptOpening && r.fired) &&
  asked.reduce((n, r) => n + r.drops + r.expired, 0) === 0 &&
  quiet.filter((r) => r.lane === "computer").every((r) => !r.fired) &&
  rows.filter((r) => r.lane === "mic").every((r) => !r.fired) &&
  asked.filter((r) => r.fired).every((r) => r.supported && r.citeOk) &&
  manualOk;
console.log(`\nVERDICT  preRoll ${PRE_ROLL}ms ${pass ? "MEETS the acceptance criteria" : "DOES NOT meet the acceptance criteria"}`);

writeFileSync(`${OUT}passb-${PRE_ROLL}.json`, JSON.stringify(rows, null, 2));
await browser.close();
