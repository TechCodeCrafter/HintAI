#!/usr/bin/env node
/**
 * Long-session stress test: does the transcript keep going?
 *
 * Mic-only (shared tab refused), which is the configuration in the report:
 * "Mic only — no shared tab, so your mic is carrying the room." Plays many real
 * utterances back to back and records whether each one reaches the transcript.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const target = process.env.QA_URL || "http://127.0.0.1:8080/";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const AUDIO = `${ROOT}.qa-audio/`;
const SHOTS = `${ROOT}screenshots/`;
const VOICE = process.env.QA_VOICE || "Samantha";
const COUNT = Number(process.env.QA_COUNT || 24);
mkdirSync(AUDIO, { recursive: true });
mkdirSync(SHOTS, { recursive: true });

const LINES = [
  "The exporter writes a settlement file every night.",
  "We capped the retries after the gateway stalled.",
  "The auth flow rotates its session cookie.",
  "Jordan moved the middleware last spring.",
  "The transcript pane shows what they said.",
  "Question detection runs on the shared tab lane.",
  "Retrieval scores every chunk in the pack.",
  "The card cites a file and a line number.",
  "We never send audio to a server by default.",
  "The whisper model runs inside a worker.",
  "Voice activity detection gates the clips.",
  "A pause commits the line to the transcript.",
];

function wav(i, text) {
  const id = `s${i}`;
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

const browser = await chromium.launch({
  ...(process.env.QA_BROWSER ? { executablePath: process.env.QA_BROWSER } : {}),
  args: ["--autoplay-policy=no-user-gesture-required"],
});
const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });

await context.addInitScript(() => {
  Object.defineProperty(window, "SpeechRecognition", { value: undefined, configurable: true });
  Object.defineProperty(window, "webkitSpeechRecognition", { value: undefined, configurable: true });

  let mic = null;
  function lane() {
    if (!mic) {
      const ctx = new AudioContext({ sampleRate: 48000 });
      mic = { ctx, dest: ctx.createMediaStreamDestination() };
    }
    return mic;
  }
  // A real microphone never goes digitally silent. Hold a quiet noise floor
  // under everything so the VAD gate has to close on its own.
  window.__groundNoise = (rms) => {
    const { ctx, dest } = lane();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * rms * Math.sqrt(3);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(dest);
    src.start();
    return true;
  };

  window.__groundPlay = async (b64) => {
    const { ctx, dest } = lane();
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
  navigator.mediaDevices.getUserMedia = async () => lane().dest.stream;
  // Mic-only: no shared tab.
  navigator.mediaDevices.getDisplayMedia = async () => {
    throw new DOMException("denied", "NotAllowedError");
  };
});

const page = await context.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(String(e)));

const room = page.locator('[data-pane="room"]');
const transcriptEl = room.locator("p.ground-transcript");

/**
 * The live draft renders inside the same <p> as committed text, so the two have
 * to be separated: only committed text means the transcript actually advanced.
 */
async function transcript() {
  if ((await transcriptEl.count()) === 0) return { committed: "", draft: "" };
  const whole = (await transcriptEl.innerText()).trim();
  // The draft span appears and vanishes on its own; a miss is not an error.
  let draft = "";
  try {
    draft = (
      await transcriptEl.locator("span.text-muted").first().innerText({ timeout: 400 })
    ).trim();
  } catch {
    draft = "";
  }
  const committed = draft && whole.endsWith(draft) ? whole.slice(0, -draft.length).trim() : whole;
  return { committed, draft };
}

await page.goto(target, { waitUntil: "networkidle", timeout: 60000 });
await page.waitForTimeout(3000);
await page.getByRole("button", { name: /^Listen$/i }).click();
await page.waitForTimeout(2500);

const noise = Number(process.env.QA_NOISE || 0);
if (noise > 0) {
  await page.evaluate((r) => window.__groundNoise(r), noise);
  console.log(`noise floor: RMS ${noise} (mic VAD gate is 0.013)`);
  await page.waitForTimeout(1500);
}

console.log(`Mic-only session, ${COUNT} utterances\n`);
console.log("  #   spoken                                    committed  grew  draft");

let prev = (await transcript()).committed;
let stalledAt = null;
let grewCount = 0;
const startedAt = Date.now();

for (let i = 0; i < COUNT; i += 1) {
  const text = LINES[i % LINES.length];
  const b64 = readFileSync(wav(i % LINES.length, text)).toString("base64");
  const durMs = await page.evaluate((d) => window.__groundPlay(d), b64);
  const endsAt = Date.now() + 0;
  void endsAt;

  // Wait for the clip to finish, then for a commit.
  await page.waitForTimeout(durMs + 700);
  let state = { committed: prev, draft: "" };
  const waitStart = Date.now();
  while (Date.now() - waitStart < 9000) {
    state = await transcript();
    if (state.committed !== prev) break;
    await page.waitForTimeout(150);
  }
  const grew = state.committed !== prev;
  if (grew) grewCount += 1;
  if (!grew && stalledAt === null) stalledAt = i + 1;
  if (grew) stalledAt = null;

  console.log(
    `  ${String(i + 1).padStart(2)}  ${text.slice(0, 40).padEnd(40)}  ${String(state.committed.length).padStart(9)}  ${grew ? "yes " : "NO  "}  "${state.draft.slice(0, 30)}"`,
  );
  prev = state.committed;
  await page.waitForTimeout(600);
}

await page.screenshot({ path: `${SHOTS}stress.png` });

console.log(`\nelapsed: ${((Date.now() - startedAt) / 1000).toFixed(0)}s`);
console.log(`utterances committed to the transcript: ${grewCount}/${COUNT}`);
console.log(`first sustained stall at utterance: ${stalledAt ?? "none"}`);
console.log(`final committed length: ${prev.length} chars`);
console.log(`console errors: ${errors.length}${errors.length ? ` — ${errors.slice(0, 4).join(" | ").slice(0, 300)}` : ""}`);
console.log(`\nfinal transcript:\n${prev.slice(-600)}`);

await browser.close();
