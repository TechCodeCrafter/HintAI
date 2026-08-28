/**
 * Retrieval-only diagnostic. Runs the P0 test questions through the old and new
 * scoring on identical material and prints the top 6 chunks, scores, files
 * selected, and whether the expected evidence made the cut.
 *
 * node --experimental-strip-types scripts/retrieval-probe.ts
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { NORTHSTAR } from "../src/lib/repo/northstar.ts";
import type { Chunk, Hit, RepoPack } from "../src/lib/repo/types.ts";
import { buildChunks, retrieve } from "../src/lib/search/retrieve.ts";
import { buildChunksBaseline, retrieveBaseline } from "./retrieve-baseline.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));

/** Every source file, the way the folder loader would take them (cap 160). */
function realPack(): RepoPack {
  const list = readdirSync(`${ROOT}src`, { recursive: true, encoding: "utf8" })
    .map((rel) => `src/${rel}`)
    .filter((p) => /\.(ts|tsx|css)$/.test(p) && !/\.test\.ts$/.test(p))
    .concat("public/ground-asr-worker.js")
    .filter((p) => statSync(`${ROOT}${p}`).isFile());

  return {
    id: "group-copilot-real",
    name: "group-copilot",
    description: "GROUND itself, loaded the way a folder loads.",
    files: list.slice(0, 160).map((path) => ({
      path,
      language: path.split(".").pop() ?? "ts",
      content: readFileSync(`${ROOT}${path}`, "utf8").slice(0, 80_000),
    })),
    commits: [],
  };
}

type Case = { q: string; want: RegExp; label: string };

const REAL_CASES: Case[] = [
  { q: "How does the question gate work?", want: /search\/question\.ts/, label: "search/question.ts" },
  { q: "Where do we handle the audio lanes?", want: /listen\/call-share\.ts/, label: "listen/call-share.ts" },
  { q: "How does retrieval score the chunks?", want: /search\/retrieve\.ts/, label: "search/retrieve.ts" },
  { q: "What does clean caption strip out?", want: /search\/question\.ts/, label: "search/question.ts" },
  { q: "How do we decide the speaker role?", want: /listen\/call-share\.ts|store\.ts/, label: "call-share.ts or store.ts" },
];

const DEMO_CASES: Case[] = [
  { q: "Why does that retry three times?", want: /exporter\/retry\.ts/, label: "exporter/retry.ts" },
  { q: "Who touched the auth flow?", want: /auth\/flow\.ts/, label: "auth/flow.ts" },
  { q: "What did we change in the exporter?", want: /exporter\//, label: "exporter/*" },
];

function show(tag: string, hits: Hit[], want: RegExp) {
  const rank = hits.findIndex((h) => want.test(h.path));
  console.log(`  ${tag}  ${rank >= 0 ? `expected evidence at rank ${rank + 1}` : "EXPECTED EVIDENCE NOT IN TOP 6"}`);
  if (hits.length === 0) console.log("      (no hits)");
  hits.forEach((h, i) => {
    const mark = want.test(h.path) ? "*" : " ";
    console.log(
      `      ${mark}${String(i + 1).padStart(2)}. ${h.score.toFixed(2).padStart(7)}  ${h.kind === "why" ? "[why] " : "[code]"} ${h.path}:${h.startLine}-${h.endLine}`,
    );
  });
  console.log(`      files: ${[...new Set(hits.map((h) => h.path))].join(", ") || "none"}`);
  return rank >= 0;
}

function run(name: string, pack: RepoPack, cases: Case[]) {
  const oldChunks: Chunk[] = buildChunksBaseline(pack);
  const newChunks: Chunk[] = buildChunks(pack);
  console.log("=".repeat(80));
  console.log(`${name}`);
  console.log(
    `${pack.files.length} files, ${pack.commits.length} commits — chunks: ${oldChunks.length} before, ${newChunks.length} after (${oldChunks.length - newChunks.length} pruned as generated)`,
  );
  console.log("=".repeat(80));

  let before = 0;
  let after = 0;
  for (const c of cases) {
    console.log(`\nQUERY  "${c.q}"`);
    console.log(`WANT   ${c.label}`);
    if (show("BEFORE", retrieveBaseline(c.q, oldChunks, 6), c.want)) before += 1;
    console.log("");
    if (show("AFTER ", retrieve(c.q, newChunks, 6), c.want)) after += 1;
  }
  console.log(`\n${name}: expected evidence in top 6 — before ${before}/${cases.length}, after ${after}/${cases.length}\n`);
  return { before, after, total: cases.length };
}

const real = run("REAL REPO (group-copilot source, no commits)", realPack(), REAL_CASES);
const demo = run("DEMO PACK (northstar-payments)", NORTHSTAR, DEMO_CASES);

console.log("=".repeat(80));
console.log(
  `TOTAL expected evidence in top 6 — before ${real.before + demo.before}/${real.total + demo.total}, after ${real.after + demo.after}/${real.total + demo.total}`,
);
console.log(`  real repo: before ${real.before}/${real.total} → after ${real.after}/${real.total}`);
console.log(`  demo pack: before ${demo.before}/${demo.total} → after ${demo.after}/${demo.total}`);
