/**
 * Dry-runs the real rdb-labsai-backend through the exact folder-loader rules
 * the UI uses, then asks candidate questions. Tells us which questions will
 * answer in the browser and which will stay silent, before demoing anything.
 *
 * node --experimental-strip-types scripts/rdb-dryrun.ts [/path/to/repo]
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import type { RepoPack } from "../src/lib/repo/types.ts";
import { prunePack } from "../src/lib/repo/folder.ts";
import { isArchitectureQuery } from "../src/lib/search/question.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { citationText } from "../src/lib/search/cite.ts";
import { buildChunks, retrieve } from "../src/lib/search/retrieve.ts";

const ROOT = process.argv[2] ?? "/Users/prajvaggu/Documents/jnjcode/rdb-labsai-backend";

// Mirrors src/lib/repo/folder.ts so this matches what "Open folder" will load.
const SKIP_DIR =
  /(^|\/)(node_modules|\.git|\.next|\.nuxt|\.turbo|\.cache|\.venv|venv|\.deno|site-packages|dist-packages|lib\/python\d|__pypackages__|\.tox|env|virtualenv|dist|build|coverage|vendor|__pycache__|out|target|\.grok|\.idea|\.vscode|\.yarn|\.pnpm-store|Pods|\.gradle|storybook-static|playwright-report|cypress\/videos|generated|proto-gen|_scm_jenkins|_scm_|jenkins|\.github|\.circleci|\.gitlab)(\/|$)/i;
const SKIP_NAME =
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|composer\.lock|\.DS_Store)(\/|$)/i;
const SKIP_EXT =
  /\.(lock|min\.js|map|png|jpe?g|gif|webp|ico|woff2?|ttf|eot|mp4|mp3|wav|zip|gz|tgz|wasm|pdf|bin|exe|dmg|svg|avif)$/i;
const ALLOW_EXT = new Set(
  "ts tsx js jsx mjs cjs py go rs java kt kts md mdx json css scss sql yml yaml toml rb php swift cs vue svelte graphql gql proto c h cc cpp hpp".split(
    " ",
  ),
);
const MAX_FILES = 160;
const MAX_FILE_BYTES = 80_000;
const MAX_TOTAL_BYTES = 2_000_000;

function extOf(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
}

function scorePath(path: string): number {
  const p = path.toLowerCase();
  let score = 0;
  if (/(^|\/)(src|lib|internal|pkg|cmd|app|apps|services|service|api|server|core|backend|domain|handlers|usecase)(\/|$)/.test(p)) score += 10;
  if (/\.(ts|tsx|go|py|java|rs|kt)$/.test(p)) score += 6;
  if (/\.(js|jsx|rb|cs)$/.test(p)) score += 3;
  if (/(adr|architecture|rfc|design-doc)/.test(p)) score += 7;
  if (/(^|\/)docs\//.test(p) && /\.md$/.test(p)) score += 4;
  if (/\.(spec|test|e2e)\./.test(p) || /(^|\/)(__tests__|testdata|fixtures|mocks|stories|e2e)(\/|$)/.test(p)) score -= 10;
  if (/(^|\/)(migrations|fixtures|snapshots|__snapshots__)(\/|$)/.test(p)) score -= 6;
  if (/(jenkins|_scm_|github\/workflows|environment-mapping|site-packages|dist-packages|deno-deck-venv)/.test(p)) score -= 40;
  if (/(^|\/)__init__\.py$/.test(p)) score -= 5;
  if (/\.(yml|yaml)$/.test(p) && !/(^|\/)(src|docs)\//.test(p)) score -= 8;
  if (/\.json$/.test(p)) score -= 2;
  const depth = p.split("/").length;
  if (depth <= 4) score += 2;
  if (depth > 8) score -= 2;
  return score;
}

type Candidate = { path: string; size: number; score: number };

const candidates: Candidate[] = [];
let skipped = 0;
const walk = (dir: string, prefix: string) => {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = `${dir}/${entry}`;
    const rel = prefix ? `${prefix}/${entry}` : entry;
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(abs);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      if (SKIP_DIR.test(`${rel}/`)) continue;
      walk(abs, rel);
      continue;
    }
    if (SKIP_DIR.test(rel) || SKIP_NAME.test(rel) || SKIP_EXT.test(rel)) {
      skipped += 1;
      continue;
    }
    if (!ALLOW_EXT.has(extOf(rel)) || s.size > MAX_FILE_BYTES) {
      skipped += 1;
      continue;
    }
    candidates.push({ path: rel, size: s.size, score: scorePath(rel) });
  }
};
walk(ROOT, "");

candidates.sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));

const files: RepoPack["files"] = [];
let total = 0;
let truncated = false;
for (const item of candidates) {
  if (files.length >= MAX_FILES || total + item.size > MAX_TOTAL_BYTES) {
    truncated = true;
    continue;
  }
  total += item.size;
  files.push({
    path: item.path,
    language: extOf(item.path),
    content: readFileSync(`${ROOT}/${item.path}`, "utf8"),
  });
}

const raw: RepoPack = {
  id: "folder-rdb-labsai-backend",
  name: "rdb-labsai-backend",
  description: `Local folder · ${files.length} files`,
  files,
  commits: [],
};
const { pack, weak, dropped } = prunePack(raw);

console.log(`REPO      ${ROOT}`);
console.log(`LOADED    ${pack.files.length} files (${(total / 1024).toFixed(0)} KB), skipped ${skipped}, truncated ${truncated}, pruned ${dropped}, weak ${weak}`);
console.log(`TOP DIRS  ${[...new Set(pack.files.map((f) => f.path.split("/")[0]))].slice(0, 12).join(", ")}`);
console.log(`\nFILES WITH A DOCSTRING/README THE CARD CAN SPEAK FROM:`);
const documented = pack.files.filter((f) => /^\s*("""|'''|\/\*\*)/.test(f.content) || /\.md$/i.test(f.path));
for (const f of documented.slice(0, 14)) {
  const first = f.content.split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4).join(" / ").slice(0, 96);
  console.log(`  ${f.path}\n      ${first}`);
}
console.log(`  (${documented.length} of ${pack.files.length} files carry prose)`);

const QUESTIONS = [
  "How does this application work end to end?",
  "How does document upload work?",
  "How is the Excel export generated?",
  "What happens after a document is uploaded?",
  "Why is this handled in the worker?",
  "How does session management work?",
  "What does the extraction do?",
  "How does the chat agent work?",
  "What does api/main.py do?",
  "How is data indexed for RAG?",
];

const chunks = buildChunks(pack);
console.log(`\nCHUNKS    ${chunks.length}`);
console.log(`\n${"=".repeat(76)}\nQUESTION RESULTS\n${"=".repeat(76)}`);

let answered = 0;
for (const query of QUESTIONS) {
  const hits = retrieve(query, chunks, 6);
  const card = localCard(query, hits, pack, 0, null);
  console.log(`\nQ  ${query}${isArchitectureQuery(query) ? "   [architecture path]" : ""}`);
  console.log(`   HITS  ${hits.slice(0, 3).map((h) => `${h.path}:${h.startLine}(${h.score.toFixed(1)})`).join(" ") || "none"}`);
  if (!card.say) {
    console.log(`   SILENT — ${card.reason ?? "no evidence"}`);
    continue;
  }
  answered += 1;
  console.log(`   SAY   ${card.say}`);
  console.log(`   CITE  ${card.citations.map(citationText).join("  ·  ")}`);
}
console.log(`\n${"=".repeat(76)}`);
console.log(`ANSWERED  ${answered}/${QUESTIONS.length}`);

// Hand the exact pack to the browser check so both test identical material.
writeFileSync("/tmp/rdb-pack.json", JSON.stringify(pack));
console.log(`pack written to /tmp/rdb-pack.json`);
