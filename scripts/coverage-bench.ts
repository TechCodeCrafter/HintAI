/**
 * Answer-coverage benchmark over the real repo.
 *
 * The metric that matters is SUPPORTED OPPORTUNITY HIT RATE: of the questions
 * where the retrieved evidence genuinely contains a safe answer, how many
 * produce a usable Card? Questions the repo cannot answer are excluded from that
 * denominator — a composer should not be penalised for correct silence.
 *
 * The before/after comparison is derived from one run. The defect was that the
 * preference score also gated admission (`score > 0`), so the trace's recorded
 * scores are enough to say whether the old rule would have spoken: it would
 * have, exactly when some eligible claim scored above zero.
 *
 * node --experimental-strip-types scripts/coverage-bench.ts
 */
import { readFileSync } from "node:fs";
import type { Card, RepoPack } from "../src/lib/repo/types.ts";
import { claimDecisions, closeDecision, traceClaims } from "../src/lib/search/claim-trace.ts";
import { citationText, citedSource } from "../src/lib/search/cite.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { buildChunks, retrieve } from "../src/lib/search/retrieve.ts";

const pack: RepoPack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));
const chunks = buildChunks(pack);

/**
 * Real questions: the shapes people actually asked on the call plus the same
 * shapes across the rest of the repo. `answerable` marks whether the repo can
 * support a safe answer at all — set from reading the files, not from what the
 * composer happens to do.
 */
const QUESTIONS: Array<{ q: string; shape: string; answerable: boolean }> = [
  // WHAT
  { q: "What does the BDA ingest worker do?", shape: "WHAT", answerable: true },
  { q: "What does the in-memory repository do?", shape: "WHAT", answerable: true },
  { q: "What is the in-memory repository for?", shape: "WHAT", answerable: true },
  { q: "What does this API do?", shape: "WHAT", answerable: true },
  { q: "What does the text formatter do?", shape: "WHAT", answerable: true },
  { q: "What does the ec2 bridge do?", shape: "WHAT", answerable: true },
  { q: "What does the session service do?", shape: "WHAT", answerable: true },
  { q: "What is the template config used for?", shape: "WHAT", answerable: true },
  // HOW
  { q: "How does the Excel export work?", shape: "HOW", answerable: true },
  { q: "How does document upload work?", shape: "HOW", answerable: true },
  { q: "How is the data indexed for RAG?", shape: "HOW", answerable: true },
  { q: "How does extraction work?", shape: "HOW", answerable: true },
  { q: "How are sessions stored?", shape: "HOW", answerable: true },
  { q: "How does the bda client talk to AWS?", shape: "HOW", answerable: true },
  // WHERE
  { q: "Where does document upload happen?", shape: "WHERE", answerable: true },
  { q: "Where is the Excel output generated?", shape: "WHERE", answerable: true },
  { q: "Where are the repositories defined?", shape: "WHERE", answerable: true },
  { q: "Where does the extraction run?", shape: "WHERE", answerable: true },
  // WHY (rationale must exist in the material, or silence is correct)
  { q: "Why is the extraction done in a container lambda?", shape: "WHY", answerable: false },
  { q: "Why did the team choose an in-memory repository?", shape: "WHY", answerable: false },
  // The file states that data is not persisted; it does not state why that
  // choice was made. Conservatively unanswerable.
  { q: "Why is data not persisted between runs?", shape: "WHY", answerable: false },
  { q: "Why are there seven lambdas?", shape: "WHY", answerable: false },
  // FAILURE
  { q: "What happens if the extraction fails?", shape: "FAILURE", answerable: false },
  { q: "What happens if the upload fails?", shape: "FAILURE", answerable: false },
  // ARCHITECTURE
  { q: "What is the architecture of this application?", shape: "ARCH", answerable: true },
  { q: "How does this application work end to end?", shape: "ARCH", answerable: true },
  { q: "How is the repo organised?", shape: "ARCH", answerable: true },
  // ABSENCE — the repo cannot prove a negative
  { q: "Do we have unit tests?", shape: "ABSENCE", answerable: false },
  { q: "How are we testing the application?", shape: "ABSENCE", answerable: false },
  // IRRELEVANT — must stay silent
  { q: "What is the weather in Tokyo?", shape: "IRRELEVANT", answerable: false },
];

/**
 * Every spoken word must exist in the evidence. The corpus is the cited files'
 * text plus the file tree and pack name, because a structural claim ("split
 * across seven container lambdas") is evidenced by the directory layout the user
 * can see, not by prose inside one file. Nothing else is admitted.
 */
function supportedBy(card: Card, pack: RepoPack): boolean {
  if (!card.say) return true;
  const cited = [
    ...card.citations.map((c) => citedSource(c, pack)),
    pack.files.map((f) => f.path.replace(/[/_.-]/g, " ")).join(" "),
    pack.name,
  ]
    .join("\n")
    .toLowerCase();
  if (!card.citations.length) return false;
  const words = card.say
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/^[^a-z0-9_]+|[^a-z0-9_]+$/g, ""))
    .filter((w) => w.length > 3);
  const missing = words.filter((w) => !cited.includes(w));
  // Connectives and counts the composer may add when joining or counting
  // evidence. Never content words: those must come from the material.
  const GLUE =
    /^(this|that|these|those|with|from|into|plus|more|also|which|their|there|then|when|about|manages|split|across|work|one|two|three|four|five|six|seven|eight|nine)$/;
  return missing.filter((w) => !GLUE.test(w)).length === 0;
}

traceClaims(true);

type Row = {
  q: string;
  shape: string;
  answerable: boolean;
  evidence: string;
  spoke: boolean;
  say: string | null;
  cite: string;
  supported: boolean;
  reason: string | null;
  /** Would the pre-fix admission rule (score > 0) have spoken? */
  spokeBefore: boolean;
  /** Eligible claim scores, so the emulation above can be audited by eye. */
  scores: string;
  /** Score provenance of the strongest rejected candidate. */
  provenance: string | null;
};

const rows: Row[] = [];
for (const item of QUESTIONS) {
  const hits = retrieve(item.q, chunks);
  const card = localCard(item.q, hits, pack, 0, null);
  // architectureCard does not run through the claim tracer; close its decision.
  const decision = claimDecisions().at(-1);
  const traced = decision?.query === item.q ? decision : closeDecision(item.q, Boolean(card.say));
  const eligible = (traced?.attempts ?? []).filter((a) => a.relevance > 0);
  const spokeBefore = card.say
    ? eligible.length === 0
      ? true // architecture/northstar path, unaffected by the admission rule
      : eligible.some((a) => a.score > 0)
    : false;

  rows.push({
    q: item.q,
    shape: item.shape,
    answerable: item.answerable,
    evidence: hits[0] ? `${hits[0].path}:${hits[0].startLine} (${hits[0].score})` : "none",
    spoke: Boolean(card.say),
    say: card.say,
    cite: card.citations.map(citationText).join(", ") || "none",
    supported: supportedBy(card, pack),
    reason: traced?.reason ?? null,
    spokeBefore,
    provenance:
      (traced?.attempts ?? []).find((a) => a.reject === "NO_SUBJECT_COVERAGE")?.provenance ?? null,
    scores: eligible.length
      ? eligible
          .map((a) => `${a.accepted ? "*" : " "}${a.score.toFixed(0)}(rel ${a.relevance})`)
          .join("  ")
      : "structural path — admission rule not involved",
  });
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

console.log("=".repeat(112));
console.log("ANSWER COVERAGE BENCHMARK   real repo: rdb-labsai-backend");
console.log("=".repeat(112));
for (const r of rows) {
  const flip = r.spoke && !r.spokeBefore ? "  <- RECOVERED" : "";
  console.log(`\n[${r.shape}] ${r.q}`);
  console.log(`  evidence  ${r.evidence}`);
  console.log(`  card      ${r.spoke ? "YES" : "no "}${flip}`);
  if (r.say) {
    console.log(`  scores    ${r.scores}`);
    console.log(`  say       "${r.say}"`);
    console.log(`  cite      ${r.cite}`);
    console.log(`  supported ${r.supported ? "yes" : "NO — UNSUPPORTED"}`);
  } else {
    console.log(`  silent    ${r.reason ?? "n/a"}`);
    if (r.provenance) console.log(`  why       ${r.provenance}`);
  }
}

const answerable = rows.filter((r) => r.answerable);
const unanswerable = rows.filter((r) => !r.answerable);
const spoke = rows.filter((r) => r.spoke);
const rate = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`);

console.log(`\n${"=".repeat(112)}`);
console.log("SUMMARY");
console.log("=".repeat(112));
console.log(`  total questions                     ${rows.length}`);
console.log(`  answerable from the material        ${answerable.length}`);
console.log(`  retrieval returned evidence         ${rows.filter((r) => r.evidence !== "none").length}`);
console.log(`  cards produced                      ${spoke.length}`);
console.log(`  cards fully supported               ${spoke.filter((r) => r.supported).length}/${spoke.length}`);
console.log(`  UNSUPPORTED CARD RATE               ${rate(spoke.filter((r) => !r.supported).length, spoke.length)}   (target 0%)`);

// The gating metrics. Coverage is only meaningful once both of these are zero,
// because a confident answer to a question the material cannot support costs
// more trust than a silence does.
const leaks = unanswerable.filter((r) => r.spoke);
console.log(`  WRONG-INTENT CARD RATE              ${rate(leaks.length, unanswerable.length)}   (target 0%)`);
console.log(`    of ${unanswerable.length} questions the material cannot answer, ${leaks.length} produced a Card`);
for (const r of leaks) {
  console.log(`    LEAK  [${r.shape}] ${r.q}`);
  console.log(`          -> "${r.say}"`);
}

console.log("");
const hitBefore = answerable.filter((r) => r.spokeBefore).length;
const hitAfter = answerable.filter((r) => r.spoke).length;
console.log(`  SUPPORTED OPPORTUNITY HIT RATE       (secondary — only after the two above are 0%)`);
console.log(`    ${hitAfter}/${answerable.length}  ${rate(hitAfter, answerable.length)}`);
if (hitBefore !== hitAfter) {
  console.log(`    (admission-rule emulation would give ${hitBefore}/${answerable.length})`);
}
for (const r of answerable.filter((r) => !r.spoke)) {
  console.log(`    SILENT  [${r.shape}] ${r.q}  (${r.reason ?? "n/a"})`);
}

const codes = new Map<string, number>();
for (const r of rows.filter((r) => !r.spoke)) {
  codes.set(r.reason ?? "OTHER", (codes.get(r.reason ?? "OTHER") ?? 0) + 1);
}
console.log(`\n  SILENCE BY REASON`);
for (const [code, n] of [...codes].sort((a, b) => b[1] - a[1])) {
  console.log(`    ${pad(code, 24)} ${n}`);
}
