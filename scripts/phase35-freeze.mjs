#!/usr/bin/env node
/**
 * Phase 3.5 freeze: fresh vs cached Cards, incremental mutation, cache
 * corruption, and performance baselines. Does not change product code.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import "fake-indexeddb/auto";

import { chunksEquivalent, indexContext, lastIndexReport } from "../src/lib/context/chunk-index.ts";
import { persistPackAsContext } from "../src/lib/context/service.ts";
import { createMemoryRepository } from "../src/lib/context/memory.ts";
import { createIndexedDbRepository } from "../src/lib/context/storage/indexeddb.ts";
import { NORTHSTAR } from "../src/lib/repo/northstar.ts";
import { localCard, questionChips } from "../src/lib/search/local-card.ts";
import { citationText } from "../src/lib/search/cite.ts";
import { buildChunks, retrieve } from "../src/lib/search/retrieve.ts";

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const OUT = `${ROOT}.eval/phase35/`;
mkdirSync(OUT, { recursive: true });

const pack = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));

const COVERAGE = [
  "What does the BDA ingest worker do?",
  "What does the in-memory repository do?",
  "What is the in-memory repository for?",
  "What does this API do?",
  "What does the text formatter do?",
  "What does the ec2 bridge do?",
  "What does the session service do?",
  "What is the template config used for?",
  "How does the Excel export work?",
  "How does document upload work?",
  "How is the data indexed for RAG?",
  "How does extraction work?",
  "How are sessions stored?",
  "How does the bda client talk to AWS?",
  "Where does document upload happen?",
  "Where is the Excel output generated?",
  "Where are the repositories defined?",
  "Where does the extraction run?",
  "Why is the extraction done in a container lambda?",
  "Why did the team choose an in-memory repository?",
  "Why is data not persisted between runs?",
  "Why are there seven lambdas?",
  "What happens if the extraction fails?",
  "What happens if the upload fails?",
  "What is the architecture of this application?",
  "How does this application work end to end?",
  "How is the repo organised?",
  "Do we have unit tests?",
  "How are we testing the application?",
  "What is the weather in Tokyo?",
];

function cardSnap(card) {
  return {
    query: card.query,
    say: card.say,
    silent: !card.say,
    reason: card.reason ?? null,
    evidence: (card.evidence ?? []).map((item) =>
      item.kind === "commit"
        ? {
            kind: item.kind,
            sha: item.sha,
            message: item.message,
            author: item.author ?? null,
            date: item.date ?? null,
            pr: item.pr ?? null,
            text: item.text,
          }
        : {
            kind: item.kind,
            path: item.path,
            startLine: item.startLine,
            endLine: item.endLine,
            startOffset: item.startOffset,
            endOffset: item.endOffset,
            text: item.text,
          },
    ),
    citations: card.citations.map((c) =>
      c.kind === "commit"
        ? { kind: c.kind, sha: c.sha, label: c.label ?? null, text: citationText(c) }
        : {
            kind: c.kind,
            path: c.path,
            line: c.line,
            endLine: c.endLine ?? null,
            label: c.label ?? null,
            text: citationText(c),
          },
    ),
  };
}

function cardsFor(runtimePack, chunks, queries) {
  return queries.map((q) => cardSnap(localCard(q, retrieve(q, chunks), runtimePack, 0, null)));
}

function diffSnaps(a, b) {
  const diffs = [];
  for (let i = 0; i < a.length; i += 1) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      diffs.push({ query: a[i].query, fresh: a[i], cached: b[i] });
    }
  }
  return diffs;
}

function reportOf(runtime) {
  return runtime.report;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}

const results = { ok: true, checks: [] };
function check(name, ok, detail = "") {
  results.checks.push({ name, ok, detail });
  if (!ok) results.ok = false;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

// --- Northstar chips -------------------------------------------------------
{
  const chunks = buildChunks(NORTHSTAR);
  const chips = questionChips(NORTHSTAR);
  const spoken = chips.map((q) => {
    const card = localCard(q, retrieve(q, chunks), NORTHSTAR, 0, null);
    return { q, snap: cardSnap(card) };
  });
  writeFileSync(`${OUT}northstar-chips.json`, JSON.stringify(spoken, null, 2));
  check(
    "Northstar chips all speak",
    spoken.every((s) => s.snap.say),
    spoken.filter((s) => !s.snap.say).map((s) => s.q).join(" | "),
  );
  const who = spoken.find((s) => s.q.startsWith("Who "));
  check(
    "Who chip uses commit evidence",
    Boolean(who?.snap.evidence.some((e) => e.kind === "commit")),
  );
  check(
    "commit citations have no file line",
    spoken.every((s) => s.snap.citations.every((c) => c.kind !== "commit" || !/:\d+/.test(c.text))),
  );
}

// --- Fresh vs cached on the evaluation Context -----------------------------
{
  const repo = createMemoryRepository();
  const saved = await persistPackAsContext(pack, repo);
  await repo.deleteIndexed(saved.context.id);
  const fresh = await indexContext(repo, saved.context.id);
  check("fresh build rebuilt every source", fresh.report.rebuiltSourceCount === pack.files.length, JSON.stringify(fresh.report));
  const freshCards = cardsFor(fresh.pack, fresh.chunks, COVERAGE);
  const cached = await indexContext(repo, saved.context.id);
  check(
    "warm reload reused every source",
    cached.report.reusedSourceCount === pack.files.length && cached.report.rebuiltSourceCount === 0,
    JSON.stringify(cached.report),
  );
  check("fresh and cached chunks equivalent", chunksEquivalent(fresh.chunks, cached.chunks));
  const cachedCards = cardsFor(cached.pack, cached.chunks, COVERAGE);
  const diffs = diffSnaps(freshCards, cachedCards);
  check("fresh and cached Cards identical", diffs.length === 0, diffs.map((d) => d.query).join(" | "));
  writeFileSync(`${OUT}cards-fresh.json`, JSON.stringify(freshCards, null, 2));
  writeFileSync(`${OUT}cards-cached.json`, JSON.stringify(cachedCards, null, 2));
  writeFileSync(
    `${OUT}retrieval-fresh.json`,
    JSON.stringify(
      COVERAGE.map((q) => ({
        q,
        hits: retrieve(q, fresh.chunks).slice(0, 6).map((h) => ({
          path: h.path,
          startLine: h.startLine,
          endLine: h.endLine,
          score: h.score,
          kind: h.kind,
        })),
      })),
      null,
      2,
    ),
  );
}

// --- Incremental mutation on the real 160-file Context ---------------------
{
  const repo = createMemoryRepository();
  const saved = await persistPackAsContext(pack, repo);
  await indexContext(repo, saved.context.id);

  const none = await indexContext(repo, saved.context.id);
  check(
    "A no changes: 160 reused",
    none.report.reusedSourceCount === 160 && none.report.rebuiltSourceCount === 0,
    JSON.stringify(none.report),
  );
  const afterNone = cardsFor(none.pack, none.chunks, ["How does the Excel export work?"]);
  check("A no changes: Excel card still speaks", Boolean(afterNone[0].say));

  const files = pack.files.map((f) => ({ ...f }));
  const changeAt = files.findIndex((f) => !/excel_output_generator/.test(f.path));
  files[changeAt] = { ...files[changeAt], content: `${files[changeAt].content}\n// phase35-changed-one\n` };
  await repo.replaceSources(saved.context.id, files);
  const one = await indexContext(repo, saved.context.id);
  check(
    "B one changed: 159 reused / 1 rebuilt",
    one.report.reusedSourceCount === 159 && one.report.rebuiltSourceCount === 1,
    JSON.stringify(one.report),
  );
  const afterOne = cardsFor(one.pack, one.chunks, ["How does the Excel export work?"]);
  check("B one changed: Excel card unchanged", afterOne[0].say === afterNone[0].say);

  files.push({
    path: "src/phase35_new_module.ts",
    language: "ts",
    content: "/** Phase 35 added source for the exporter notes. */\nexport const PHASE35 = 1;\n",
  });
  await repo.replaceSources(saved.context.id, files);
  const added = await indexContext(repo, saved.context.id, { skipPrune: true });
  check(
    "C one added: only new source rebuilt",
    added.report.newSourceCount === 1 && added.report.reusedSourceCount === 160,
    JSON.stringify(added.report),
  );

  const withoutNew = files.filter((f) => f.path !== "src/phase35_new_module.ts");
  await repo.replaceSources(saved.context.id, withoutNew);
  const deleted = await indexContext(repo, saved.context.id, { skipPrune: true });
  check(
    "D one deleted: cached source removed",
    deleted.report.deletedSourceCount === 1 && (await repo.listIndexed(saved.context.id)).length === 160,
    JSON.stringify(deleted.report),
  );

  const several = withoutNew.map((f, i) =>
    i < 16 ? { ...f, content: `${f.content}\n// phase35-changed-batch-${i}\n` } : f,
  );
  await repo.replaceSources(saved.context.id, several);
  const batch = await indexContext(repo, saved.context.id, { skipPrune: true });
  check(
    "E 16 changed: only those rebuilt",
    batch.report.rebuiltSourceCount === 16 && batch.report.reusedSourceCount === 144,
    JSON.stringify(batch.report),
  );
  const afterBatch = cardsFor(batch.pack, batch.chunks, ["How does the Excel export work?"]);
  check("E several changed: Excel card still speaks", Boolean(afterBatch[0].say));
}

// --- Cache corruption recovery ---------------------------------------------
{
  const repo = createMemoryRepository();
  const saved = await persistPackAsContext(pack, repo);
  await indexContext(repo, saved.context.id);
  const sources = await repo.listSources(saved.context.id);
  const target = sources.find((s) => /excel_output_generator/.test(s.path)) ?? sources[0];
  const original = target.content;
  repo.corruptChunks(saved.context.id, target.id, [{ id: "bad", kind: "code" }]);
  const recovered = await indexContext(repo, saved.context.id);
  const still = (await repo.listSources(saved.context.id)).find((s) => s.id === target.id);
  check("corrupt cache: canonical source survives", still?.content === original);
  check("corrupt cache: Context still ready with chunks", recovered.chunks.length > 0 && recovered.report.rebuiltSourceCount >= 1);
  check("corrupt cache: bad chunk not searchable", recovered.chunks.every((c) => c.id !== "bad"));
  const excel = localCard(
    "How does the Excel export work?",
    retrieve("How does the Excel export work?", recovered.chunks),
    recovered.pack,
    0,
    null,
  );
  check("corrupt cache: Excel question still answers", Boolean(excel.say), excel.say ?? excel.reason);

  const idb = createIndexedDbRepository(`phase35-corrupt-${Date.now()}`);
  const idbSaved = await persistPackAsContext(pack, idb);
  await indexContext(idb, idbSaved.context.id);
  const ledgers = await idb.listIndexed(idbSaved.context.id);
  const first = ledgers[0];
  await idb.writeIndexed({ ...first, chunkCount: 99, indexVersion: first.indexVersion }, []);
  const idbRecovered = await indexContext(idb, idbSaved.context.id);
  check(
    "IDB count-mismatch rebuilds that source",
    idbRecovered.report.rebuiltSourceCount >= 1 && idbRecovered.chunks.length > 0,
    JSON.stringify(idbRecovered.report),
  );
}

// --- Performance: Northstar, eval pack, realistic ingest, synthetic --------
function realisticIngestPack() {
  const files = [];
  const line =
    "  // realistic source line for settlement export batch processing and retry backoff\n";
  for (let i = 0; i < 160; i += 1) {
    const head = [
      `/** Module ${i} handles settlement batch ${i} for the exporter pipeline. */`,
      `export const MODULE_${i} = ${i};`,
      `export function run${i}() { return MODULE_${i}; }`,
      "",
    ].join("\n");
    const pad = line.repeat(120);
    files.push({
      path: `src/mod-${String(i).padStart(3, "0")}/service.ts`,
      language: "ts",
      content: head + pad,
    });
  }
  files[0] = {
    path: "src/exporter/retry.ts",
    language: "ts",
    content: `/**
 * Retry policy for settlement exports.
 *
 * Attempts are capped at three because the payment gateway stalls rather than
 * failing fast, so a fourth attempt duplicates the settlement file instead of
 * recovering it.
 */
export const MAX_ATTEMPTS = 3;

export function backoffMs(attempt) {
  return 400 * 2 ** (Math.min(attempt, MAX_ATTEMPTS) - 1);
}
${line.repeat(100)}`,
  };
  return {
    id: "ingest-capacity",
    name: "ingest-capacity",
    description: "Worst practical corpus under current folder limits",
    commits: [],
    files,
  };
}

function syntheticTiny(n) {
  const files = [];
  for (let i = 0; i < n; i += 1) {
    files.push({
      path: `src/mod-${String(i).padStart(4, "0")}.ts`,
      language: "ts",
      content: `/** Module ${i} stable for the synthetic index bench. */\nexport const v${i} = ${i};\n`,
    });
  }
  return { id: `syn-${n}`, name: `synthetic-${n}`, description: `${n} files`, commits: [], files };
}

async function timeIndex(label, repo, id, times, opts = {}) {
  const runs = [];
  for (let i = 0; i < times; i += 1) {
    runs.push(reportOf(await indexContext(repo, id, opts)));
  }
  const totals = runs.map((r) => r.totalMs);
  return {
    label,
    n: times,
    last: runs.at(-1),
    p50: percentile(totals, 50),
    p95: percentile(totals, 95),
  };
}

const perf = {};

{
  const repo = createMemoryRepository();
  const saved = await persistPackAsContext({ ...NORTHSTAR, commits: [] }, repo);
  await repo.deleteIndexed(saved.context.id);
  perf.northstarCold = reportOf(await indexContext(repo, saved.context.id));
  perf.northstarWarm = await timeIndex("northstar warm", repo, saved.context.id, 11);
}

{
  const repo = createMemoryRepository();
  const saved = await persistPackAsContext(pack, repo);
  await repo.deleteIndexed(saved.context.id);
  perf.evalCold = reportOf(await indexContext(repo, saved.context.id));
  perf.evalWarm = await timeIndex("eval warm", repo, saved.context.id, 11);
  const files = pack.files.map((f, i) =>
    i === 0 ? { ...f, content: `${f.content}\n// one-changed\n` } : f,
  );
  await repo.replaceSources(saved.context.id, files);
  perf.evalOne = reportOf(await indexContext(repo, saved.context.id));
  const ten = pack.files.map((f, i) =>
    i < 16 ? { ...f, content: `${f.content}\n// ten-changed-${i}\n` } : f,
  );
  await repo.replaceSources(saved.context.id, ten);
  perf.evalTen = reportOf(await indexContext(repo, saved.context.id));
  const all = pack.files.map((f, i) => ({ ...f, content: `${f.content}\n// all-${i}\n` }));
  await repo.replaceSources(saved.context.id, all);
  perf.evalAll = reportOf(await indexContext(repo, saved.context.id));

  const idb = createIndexedDbRepository(`phase35-perf-${Date.now()}`);
  const idbSaved = await persistPackAsContext(pack, idb);
  perf.evalIdbCold = reportOf(await indexContext(idb, idbSaved.context.id));
  perf.evalIdbWarm = await timeIndex("eval idb warm", idb, idbSaved.context.id, 7);
}

{
  const ingest = realisticIngestPack();
  const bytes = ingest.files.reduce((n, f) => n + f.content.length, 0);
  const repo = createMemoryRepository();
  const saved = await persistPackAsContext(ingest, repo);
  await repo.deleteIndexed(saved.context.id);
  const cold = await indexContext(repo, saved.context.id);
  const warm = await indexContext(repo, saved.context.id);
  perf.ingest = {
    files: ingest.files.length,
    bytes,
    chunks: cold.chunks.length,
    cold: cold.report,
    warm: warm.report,
  };
  check(
    "realistic ingest warm reuses all sources",
    warm.report.reusedSourceCount === 160 && warm.report.rebuiltSourceCount === 0,
    JSON.stringify(warm.report),
  );
  check(
    "realistic ingest under 2MB product cap",
    bytes <= 2_000_000,
    `${bytes} bytes`,
  );
}

{
  const repo = createMemoryRepository();
  const saved = await persistPackAsContext(syntheticTiny(1000), repo);
  perf.syn1000Cold = reportOf(await indexContext(repo, saved.context.id, { skipPrune: true }));
  perf.syn1000Warm = reportOf(await indexContext(repo, saved.context.id, { skipPrune: true }));
}

writeFileSync(`${OUT}perf.json`, JSON.stringify(perf, null, 2));
writeFileSync(
  `${OUT}checks.json`,
  JSON.stringify({ ok: results.ok, checks: results.checks, lastIndex: lastIndexReport() }, null, 2),
);

console.log("\n--- performance snapshot ---");
console.log(
  JSON.stringify(
    {
      northstarColdMs: perf.northstarCold.totalMs,
      northstarWarmP50: perf.northstarWarm.p50,
      evalColdMs: perf.evalCold.totalMs,
      evalWarmP50: perf.evalWarm.p50,
      evalWarmP95: perf.evalWarm.p95,
      evalIdbColdMs: perf.evalIdbCold.totalMs,
      evalIdbWarmP50: perf.evalIdbWarm.p50,
      ingestColdMs: perf.ingest.cold.totalMs,
      ingestWarmMs: perf.ingest.warm.totalMs,
      ingestChunks: perf.ingest.chunks,
      ingestBytes: perf.ingest.bytes,
    },
    null,
    2,
  ),
);

console.log(`\n${results.checks.filter((c) => c.ok).length}/${results.checks.length} freeze checks passed`);
process.exit(results.ok ? 0 : 1);
