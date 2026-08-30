#!/usr/bin/env node
/**
 * CALL-lane proof for the question-gate pass.
 *
 * The failure being closed: a legitimate question is answered, the next thing
 * the room says is chatter, and the gate walks backward and re-fires the old
 * question. This speaks a real question, then chatter, then a genuine
 * follow-up, and asserts the Card only ever moves on the newest question.
 *
 * Every decision is read back out of window.__groundGate, so a silent room is
 * explainable rather than merely quiet.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const AUDIO = `${ROOT}.qa-audio/gate/`;
mkdirSync(AUDIO, { recursive: true });
const THEM = "Daniel";
const ME = "Samantha";
const CLEAR_QUERY = "zzqqxx nothing matches this";

const pack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));
const fileText = new Map(pack.files.map((f) => [f.path, f.content]));

/**
 * Order matters: chatter is only dangerous once a question has been answered,
 * because that is when there is something in the window worth resurrecting.
 */
const SCRIPT = [
  { id: "q1", kind: "question", text: "How does the Excel export work?", cite: "excel_output_generator" },
  // Byte-identical repeat. Reported, not asserted: this pass only has to prove
  // the instrumentation catches it, so the next pass can pin the cause.
  { id: "q1b", kind: "repeat", text: "How does the Excel export work?" },
  // Straight after its question, while the thread the gate needs is still open.
  { id: "f1", kind: "follow-up", text: "And where is that stored?" },
  { id: "c1", kind: "chatter", text: "Can you hear me?" },
  { id: "c2", kind: "chatter", text: "Can everyone see my screen?" },
  { id: "c3", kind: "chatter", text: "Should we move on?" },
  { id: "c4", kind: "chatter", text: "Are we good on time?" },
  { id: "c5", kind: "chatter", text: "Any questions?" },
  { id: "c6", kind: "chatter", text: "Sorry, can you repeat that?" },
  // Sequence F on the real lane: the same question again, with chatter between it
  // and the original ask.
  { id: "q1c", kind: "repeat", text: "How does the Excel export work?" },
  { id: "q2", kind: "question", text: "What does the BDA ingest worker do?", cite: "bda-ingest-worker" },
  { id: "f2", kind: "follow-up", text: "Why is it done that way?" },
  { id: "c7", kind: "chatter", text: "Can you hear me?" },
  { id: "mic", kind: "mic", text: "How does the Excel export work?" },
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
await context.addInitScript(() => {
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
    src.start();
    return { durMs: audio.duration * 1000 };
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
  const cites = (await btns.count()) ? (await btns.allInnerTexts()).map((t) => t.replace(/\s+/g, "")) : [];
  return { say, cites };
}

await page.goto("http://127.0.0.1:8080/app", { waitUntil: "domcontentloaded", timeout: 60000 });
await room.waitFor({ state: "visible", timeout: 60000 });
for (let i = 0; i < 400; i += 1) {
  const text = await room.innerText();
  if (i > 4 && !/Downloading captions|Loading captions|Starting captions/i.test(text)) break;
  await page.waitForTimeout(250);
}
await page.getByRole("button", { name: /^Listen$/i }).click();
await page.waitForTimeout(2500);

console.log("CALL-LANE GATE REGRESSION   preRoll=500ms  lane=shared tab (CALL) unless marked mic\n");

const rows = [];
let previous = (await readCard()).say;

for (const step of SCRIPT) {
  const lane = step.kind === "mic" ? "mic" : "computer";
  const b64 = readFileSync(wav(step.id, step.text, lane === "mic" ? ME : THEM)).toString("base64");
  const before = (await readCard()).say;
  // Asking the same question twice composes byte-identical Card text, so the DOM
  // cannot prove a second Card. The gate's own decisions can.
  const seen = await page.evaluate(() => (window.__groundGate?.records() ?? []).length);
  await page.evaluate(([n, d]) => window.__groundPlay(n, d), [lane, b64]);

  // Long enough for a Card to land if one is coming, so silence is real silence.
  await page.waitForTimeout(11000);
  const fresh = await page.evaluate((n) => (window.__groundGate?.records() ?? []).slice(n), seen);
  const gated = fresh.some((r) => r.triggered);
  const after = await readCard();
  // A Card that went blank is silence, not a new answer. Chatter is held to the
  // stricter bar: it must leave the existing Card exactly as it was.
  const moved = Boolean(after.say) && after.say !== before;
  const touched = after.say !== before;
  const citePaths = after.cites.map((c) => c.replace(/:\d+$/, ""));
  const support = moved ? claimSupport(after.say, citePaths) : null;

  rows.push({ ...step, lane, before, say: after.say, moved, touched, gated, fresh, citePaths, support });
  const verdict =
    step.kind === "repeat"
      ? gated ? "reached the gate again (second answer)" : "FAIL — second ask never reached the gate"
      : step.kind === "chatter" || step.kind === "mic"
        ? gated || touched ? `FAIL — retrieval ran / Card changed to "${after.say.slice(0, 40)}"` : "silent (correct)"
        : moved ? "Card fired" : "FAIL — no Card";
  console.log(`[${step.id.padEnd(4)}] ${step.kind.padEnd(10)} ${verdict}`);
  if (moved) {
    console.log(`         say    "${after.say.slice(0, 84)}"`);
    console.log(`         cite   ${after.cites.join(" · ")}  support ${support?.ok ? "PASS" : `FAIL(${support?.missing.join(",")})`}`);
  }
  previous = after.say;
}

// Manual Search must be untouched by a gate change.
await page.locator("textarea.ground-question").fill("How is the data indexed for RAG?");
await page.keyboard.press("Enter");
await page.waitForTimeout(3000);
const manual = await readCard();
await page.locator("textarea.ground-question").fill(CLEAR_QUERY);
await page.keyboard.press("Enter");
await page.waitForTimeout(1200);

const records = await page.evaluate(() => window.__groundGate?.records() ?? []);

console.log(`\n${"=".repeat(104)}`);
console.log("GATE DECISION LOG (what the gate saw, and why the room was silent)");
console.log("=".repeat(104));
console.log(`  ${"event".padEnd(12)} ${"candidate".padEnd(42)} ${"verdict".padEnd(20)} ${"ctx".padEnd(4)} fired`);
for (const r of records) {
  console.log(
    `  ${String(r.candidateId).padEnd(12)} ${String(r.candidate).slice(0, 41).padEnd(42)} ` +
      `${String(r.verdict).padEnd(20)} ${String(r.context.length).padEnd(4)} ${r.triggered ? "yes" : "no"}`,
  );
  if (r.usedContext) console.log(`      -> resolved: "${r.question}"`);
}

const chatter = rows.filter((r) => r.kind === "chatter");
const questions = rows.filter((r) => r.kind === "question");
const follow = rows.filter((r) => r.kind === "follow-up");
const mic = rows.filter((r) => r.kind === "mic");
const fired = rows.filter((r) => r.moved);

console.log(`\n${"=".repeat(104)}`);
console.log("STOP CONDITION");
console.log("=".repeat(104));
console.log(`  chatter Cards                  ${chatter.filter((r) => r.moved).length}/${chatter.length}   (must be 0)`);
console.log(`  chatter left the Card alone    ${chatter.filter((r) => !r.touched).length}/${chatter.length}`);
console.log(`  questions answered             ${questions.filter((r) => r.moved).length}/${questions.length}`);
// This pass owns whether a follow-up is allowed to retrieve, not whether the
// material can answer it. Whether a Card lands is reported, but silence with no
// supporting evidence is the cite-or-stay-silent contract, not a gate failure.
const followGated = records.filter((r) => r.verdict === "follow-up" && r.triggered);
console.log(`  follow-ups allowed to retrieve ${followGated.length}/${follow.length}  (gate scope)`);
console.log(`  follow-ups that found evidence ${follow.filter((r) => r.moved).length}/${follow.length}  (retrieval scope)`);
console.log(`  mic auto-trigger               ${mic.every((r) => !r.moved && !r.gated) ? "none (correct)" : "MIC TRIGGERED RETRIEVAL"}`);
console.log(`  support validator              ${fired.filter((r) => r.support?.ok).length}/${fired.length} of fired Cards fully supported`);
console.log(`  manual Search                  ${manual.say ? "works" : "BROKEN"}`);
const repeats = rows.filter((r) => r.kind === "repeat");
console.log(`  repeat ask reached the gate     ${repeats.filter((r) => r.gated).length}/${repeats.length}   (must be all)`);
console.log(`  events dropped for equal text  ${records.filter((r) => r.verdict === "repeat-of-same-event").length}   (must be 0)`);
console.log(`  console errors                 ${consoleErrors.length}`);

const pass =
  chatter.every((r) => !r.touched && !r.gated) &&
  repeats.every((r) => r.gated) &&
  records.every((r) => r.verdict !== "repeat-of-same-event") &&
  questions.every((r) => r.moved) &&
  followGated.length === follow.length &&
  mic.every((r) => !r.moved && !r.gated) &&
  fired.every((r) => r.support?.ok) &&
  Boolean(manual.say);
console.log(`\nVERDICT  ${pass ? "gate pass MEETS the stop condition" : "gate pass DOES NOT meet the stop condition"}`);

await browser.close();
