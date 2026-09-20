#!/usr/bin/env node
/**
 * Regenerate public/og.jpg — 1200×630 share card for og:image / Twitter cards.
 * Code-drawn lockup so the wordmark is always exact (no generative glyph drift).
 */
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tmpDir = join(root, ".grok");
const jpgTmp = join(tmpDir, "og-card.jpg");
const outPath = join(root, "public/og.jpg");

mkdirSync(tmpDir, { recursive: true });

const args = [
  "-size",
  "1200x630",
  "xc:#07090c",
  "-fill",
  "#67e8f9",
  "-draw",
  "rectangle 80,316 1120,319",
  "-fill",
  "rgba(103,232,249,0.25)",
  "-draw",
  "rectangle 0,304 1200,328",
  "-font",
  "Georgia",
  "-pointsize",
  "128",
  "-fill",
  "#eef2ff",
  "-gravity",
  "center",
  "-annotate",
  "+0-55",
  "Hint",
  "-font",
  "Georgia",
  "-pointsize",
  "26",
  "-fill",
  "#94a3b8",
  "-gravity",
  "center",
  "-annotate",
  "+0+55",
  "listen · cite · say",
  "-quality",
  "88",
  jpgTmp,
];

const convert = spawnSync("magick", args, { encoding: "utf8" });
if (convert.status !== 0) {
  console.error(convert.stderr || convert.stdout);
  process.exit(convert.status ?? 1);
}

const handoff = spawnSync("node", ["scripts/write-atomic.mjs", jpgTmp, outPath], {
  cwd: root,
  encoding: "utf8",
});
if (handoff.status !== 0) {
  console.error(handoff.stderr || handoff.stdout);
  process.exit(handoff.status ?? 1);
}

console.log(`Wrote ${outPath}`);
