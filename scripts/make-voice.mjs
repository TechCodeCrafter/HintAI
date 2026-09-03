#!/usr/bin/env node
/**
 * Speaks src/remotion/vo-script.json one line at a time so each clip sits on
 * its own beat. Writes a master manifest and a social manifest.
 *
 * Prefers OpenAI TTS when OPENAI_API_KEY is set. Falls back to macOS `say`.
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const OUT_DIR = join(ROOT, "assets/remotion/vo");
const SCRIPT = JSON.parse(readFileSync(join(ROOT, "src/remotion/vo-script.json"), "utf8"));
const RATE = Number(process.env.RATE ?? 152);

const CAST = {
  pm: {
    voice: "nova",
    style:
      "You are a product manager on a laptop video call. Slightly compressed, conversational. Do not linger. Read the words only.",
  },
  engineer: {
    voice: "onyx",
    style:
      "You are an engineer reading a line from a second monitor. Relaxed, sure, conversational pace. Do not linger. Read the words only.",
  },
  narrator: {
    voice: "ash",
    style:
      "You are a SaaS account exec on a Zoom with a student in office hours. You've sat in that meeting. Talk like a person, not an ad. A little smile. Name the pain, then sell the product. Keep moving — no dramatic pauses. Not a radio announcer. Not a documentary. Read the words only.",
  },
};

const FALLBACK_STYLE = "Speak clearly, conversational pace, no extra words. Read the script only.";

function loadDotEnv() {
  try {
    for (const raw of readFileSync(join(ROOT, ".env"), "utf8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 1) continue;
      const key = line.slice(0, eq);
      let value = line.slice(eq + 1);
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch {
    /* no local .env */
  }
}

loadDotEnv();

const OPENAI_KEY = process.env.OPENAI_API_KEY?.trim();
const TTS_MODEL = process.env.TTS_MODEL ?? "gpt-4o-mini-tts";

function pickSayVoice() {
  if (process.env.VOICE) return process.env.VOICE;
  const listed = execFileSync("say", ["-v", "?"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.match(/^(.+?)\s{2,}([a-z]{2}_[A-Z]{2})/))
    .filter(Boolean)
    .map(([, name, locale]) => ({ name: name.trim(), locale }))
    .filter((voice) => voice.locale.startsWith("en"));

  const rank = (name) =>
    /\(Premium\)/.test(name) ? 3 : /\(Enhanced\)/.test(name) ? 2 : name === "Samantha" ? 1 : 0;
  const best = listed.sort((a, b) => rank(b.name) - rank(a.name))[0];
  if (!best) throw new Error("no English system voice available");
  return best.name;
}

function wavSeconds(file) {
  return (statSync(file).size - 44) / 96000;
}

function toPcm48(src, dest, tempo = 1) {
  const args = ["-y", "-i", src];
  if (tempo > 1.01) args.push("-filter:a", `atempo=${tempo.toFixed(3)}`);
  args.push("-acodec", "pcm_s16le", "-ar", "48000", "-ac", "1", dest);
  execFileSync("ffmpeg", args, { stdio: "ignore" });
}

function speakSay(text, file) {
  const voice = pickSayVoice();
  execFileSync("say", [
    "-v",
    voice,
    "-r",
    String(RATE),
    "--data-format=LEI16@48000",
    "-o",
    file,
    text,
  ]);
  return { seconds: wavSeconds(file), voice: `say/${voice}` };
}

async function speakOpenAI(text, file, role) {
  const cast = CAST[role] ?? {};
  const voice = process.env.VOICE ?? cast.voice ?? "verse";
  const instructions = cast.style ?? FALLBACK_STYLE;
  const res = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENAI_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: TTS_MODEL,
      voice,
      input: text,
      instructions,
      response_format: "wav",
    }),
  });
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`openai tts ${res.status}: ${detail.slice(0, 240)}`);
  }
  const raw = `${file}.in`;
  writeFileSync(raw, Buffer.from(await res.arrayBuffer()));
  toPcm48(raw, file);
  rmSync(raw, { force: true });
  return { seconds: wavSeconds(file), voice: `openai/${TTS_MODEL}/${voice}` };
}

async function speakFilm(name, film, prefix) {
  const clips = [];
  const overruns = [];
  let used = null;

  for (const [i, line] of film.lines.entries()) {
    const dest = join(OUT_DIR, `${prefix}${String(i + 1).padStart(2, "0")}.wav`);
    const spoken = OPENAI_KEY
      ? await speakOpenAI(line.text, dest, line.role)
      : speakSay(line.text, dest);
    used = spoken.voice;
    const next = film.lines[i + 1]?.at ?? film.seconds;
    const room = next - line.at;
    if (spoken.seconds > room && spoken.seconds / room <= 1.65) {
      const fitted = `${dest}.fit.wav`;
      toPcm48(dest, fitted, spoken.seconds / (room - 0.08));
      rmSync(dest);
      writeFileSync(dest, readFileSync(fitted));
      rmSync(fitted);
      spoken.seconds = wavSeconds(dest);
    }
    if (spoken.seconds > room) overruns.push({ film: name, i: i + 1, seconds: spoken.seconds, room, text: line.text });
    clips.push({
      file: `vo/${prefix}${String(i + 1).padStart(2, "0")}.wav`,
      at: line.at,
      seconds: Number(spoken.seconds.toFixed(2)),
      text: line.text,
    });
    console.log(
      `${name.padEnd(6)} ${String(i + 1).padStart(2, "0")}  ${line.at.toFixed(1).padStart(4)}s  ` +
        `${spoken.seconds.toFixed(2)}s / ${room.toFixed(2)}s  ${spoken.seconds > room ? "OVERRUN" : "ok"}  ` +
        `${line.text.slice(0, 46)}${line.text.length > 46 ? "…" : ""}`,
    );
  }

  return { clips, overruns, used };
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true });
  mkdirSync(OUT_DIR, { recursive: true });

  const master = await speakFilm("master", SCRIPT.films.master, "");
  const social = await speakFilm("social", SCRIPT.films.social, "s");
  const overruns = [...master.overruns, ...social.overruns];

  writeFileSync(
    join(ROOT, "src/remotion/vo-manifest.json"),
    `${JSON.stringify(
      {
        comment: "Generated by `npm run voice`. Empty clips means the film plays scored, with no narration.",
        voice: master.used,
        clips: master.clips,
      },
      null,
      2,
    )}\n`,
  );
  writeFileSync(
    join(ROOT, "src/remotion/vo-social-manifest.json"),
    `${JSON.stringify(
      {
        comment: "Generated by `npm run voice`. Social cut.",
        voice: social.used,
        clips: social.clips,
      },
      null,
      2,
    )}\n`,
  );

  console.log(`\nvoice   ${master.used}`);
  console.log(`clips   ${master.clips.length} master + ${social.clips.length} social → assets/remotion/vo/`);
  if (!OPENAI_KEY) {
    console.log("note    no OPENAI_API_KEY — used macOS say, which sounds synthetic.");
  }
  if (overruns.length) {
    console.log(`\n${overruns.length} line(s) run past their beat — shorten the copy:`);
    for (const o of overruns) {
      console.log(`  ${o.film} ${o.i}: ${o.seconds.toFixed(2)}s in a ${o.room.toFixed(2)}s slot — "${o.text}"`);
    }
    process.exitCode = 1;
  }
}

await main();
