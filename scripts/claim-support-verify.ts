/**
 * Verifies the citation contract on the real material: every identifier the
 * Card speaks must exist in the raw cited file. The validator compares against
 * the file on disk, never against normalized text, so a transformation cannot
 * make itself look correct.
 *
 * node --experimental-strip-types scripts/claim-support-verify.ts
 */
import { readFileSync } from "node:fs";
import type { RepoPack } from "../src/lib/repo/types.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { citationText } from "../src/lib/search/cite.ts";
import { plain } from "../src/lib/search/prose.ts";
import { buildChunks, retrieve } from "../src/lib/search/retrieve.ts";

const pack: RepoPack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));
const fileText = new Map(pack.files.map((f) => [f.path, f.content]));

/** The normalization as it shipped before this pass, for the before/after. */
function oldPlain(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]{1,3}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** The prose a file states about itself, raw and unnormalized. */
function rawDoc(path: string): string {
  const content = fileText.get(path) ?? "";
  if (/\.(md|mdx|rst|txt)$/i.test(path)) {
    return content.split("\n").filter(Boolean).slice(0, 6).join("\n");
  }
  const py = content.match(/(?:"""|''')([\s\S]*?)(?:"""|''')/)?.[1];
  if (py) return py.split("\n").filter(Boolean).slice(0, 8).join("\n");
  const js = content.match(/\/\*\*?([\s\S]*?)\*\//)?.[1];
  return js ? js.replace(/^\s*\*+/gm, "").split("\n").filter(Boolean).slice(0, 8).join("\n") : "";
}

const GLUE = new Set([
  "this","that","with","from","into","also","when","which","where","their","them","there","then",
  "have","been","being","does","service","split","across","work","plus","more","other","using",
  "rdb-labsai-backend","fastapi",
]);

/**
 * Unchanged from the real-call harness. Every content word of the spoken claim
 * must appear in the raw cited evidence.
 */
function claimSupport(say: string, citePaths: string[]) {
  const corpus = citePaths.map((p) => fileText.get(p) ?? "").join("\n").toLowerCase();
  const content = [
    ...new Set(
      say
        .toLowerCase()
        .split(/\s+/)
        .map((w) => w.replace(/^[^a-z0-9_]+/, "").replace(/[^a-z0-9_]+$/, ""))
        .filter((w) => w.length > 4 && !GLUE.has(w)),
    ),
  ];
  const missing = content.filter((w) => !corpus.includes(w));
  return { ok: missing.length === 0, missing, checked: content.length };
}

/** The identifiers in a claim — the tokens that must survive exactly. */
function identifiers(say: string): string[] {
  return [...new Set(say.split(/\s+/).map((w) => w.replace(/^[^A-Za-z0-9_]+/, "").replace(/[^A-Za-z0-9_]+$/, "")))]
    .filter((w) => w.includes("_"));
}

// Every question from the real-call harness, failures first.
const QUESTIONS = [
  { q: "Why is the extraction done in a container lambda?", note: "previously UNSUPPORTED" },
  { q: "How is the data indexed for RAG?", note: "previously UNSUPPORTED" },
  { q: "Where does document upload happen?", note: "previously flagged by a harness bug" },
  { q: "What does the BDA ingest worker do?", note: "previously OK" },
  { q: "How does the Excel export work?", note: "previously OK" },
];

const chunks = buildChunks(pack);
let pass = 0;
let checked = 0;

for (const { q, note } of QUESTIONS) {
  const hits = retrieve(q, chunks, 6);
  const card = localCard(q, hits, pack, 0, null);
  console.log(`\n${"=".repeat(78)}\nQUESTION           ${q}\n                   (${note})\n${"=".repeat(78)}`);
  if (!card.say) {
    console.log(`SILENT — ${card.reason ?? "no evidence"}`);
    continue;
  }
  const citePaths = card.citations.flatMap((c) => (c.kind === "file" ? [c.path] : []));
  const source = rawDoc(citePaths[0] ?? "");
  const sourceLine =
    source
      .split("\n")
      .find((l) => /_|`/.test(l) && l.trim().length > 12) ?? source.split("\n")[0] ?? "";

  console.log(`\nSOURCE TEXT        ${sourceLine.trim()}`);
  console.log(`NORMALIZED (was)   ${oldPlain(sourceLine).trim()}`);
  console.log(`NORMALIZED (now)   ${plain(sourceLine).trim()}`);
  console.log(`\nFINAL CARD         ${card.say}`);
  console.log(`CITATION           ${card.citations.map(citationText).join("  ·  ")}`);

  const support = claimSupport(card.say, citePaths);
  const ids = identifiers(card.say);
  checked += 1;
  if (support.ok) pass += 1;
  console.log(
    `\nCLAIM SUPPORT      ${support.ok ? `PASS — all ${support.checked} content words found in the raw cited file(s)` : `FAIL — absent from cited evidence: ${support.missing.join(", ")}`}`,
  );
  if (ids.length) {
    for (const id of ids) {
      const raw = citePaths.map((p) => fileText.get(p) ?? "").join("\n");
      console.log(`  identifier "${id}" ${raw.includes(id) ? "found verbatim in cited file" : "NOT IN CITED FILE"}`);
    }
  } else {
    console.log("  (no underscore identifiers in this claim)");
  }
}

console.log(`\n${"=".repeat(78)}`);
console.log(`CLAIM SUPPORT: ${pass}/${checked} Cards fully supported by their citation`);
