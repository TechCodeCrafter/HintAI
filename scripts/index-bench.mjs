#!/usr/bin/env node
/**
 * Phase 3 incremental-index timings. Uses the in-memory repository so the
 * numbers measure chunk reuse, not Dexie.
 */
import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import { createMemoryRepository } from "../src/lib/context/memory.ts";
import { createIndexedDbRepository } from "../src/lib/context/storage/indexeddb.ts";
import { persistPackAsContext } from "../src/lib/context/service.ts";
import { chunksEquivalent, indexContext } from "../src/lib/context/chunk-index.ts";
import { NORTHSTAR } from "../src/lib/repo/northstar.ts";
import { localCard } from "../src/lib/search/local-card.ts";
import { buildChunks, retrieve } from "../src/lib/search/retrieve.ts";

function file(path, content) {
  return { path, language: "ts", content };
}

function syntheticPack(n, mutate = new Set()) {
  const files = [];
  for (let i = 0; i < n; i += 1) {
    const extra = mutate.has(i) ? `changed-${Date.now()}-${i}` : "stable";
    files.push(
      file(
        `src/mod-${String(i).padStart(4, "0")}.ts`,
        `/** Module ${i} ${extra} for the synthetic index bench. */\nexport const v${i} = ${i};\n`,
      ),
    );
  }
  return { id: `syn-${n}`, name: `synthetic-${n}`, description: `${n} files`, commits: [], files };
}

function print(label, runtime) {
  const r = runtime.report;
  console.log(
    `${label.padEnd(28)} total=${r.totalMs.toFixed(1)}ms  hydrate=${r.hydrateMs.toFixed(1)}  hash=${r.hashCompareMs.toFixed(1)}  cache=${r.cacheReadMs.toFixed(1)}  chunk=${r.chunkBuildMs.toFixed(1)}  assemble=${r.assembleMs.toFixed(1)}  vocab=${r.vocabMs.toFixed(1)}  reusedS=${r.reusedSourceCount} rebuiltS=${r.rebuiltSourceCount} newS=${r.newSourceCount} delS=${r.deletedSourceCount} reusedC=${r.reusedChunkCount} rebuiltC=${r.rebuiltChunkCount}`,
  );
}

const repo = createMemoryRepository();

console.log("A. Northstar (in-memory buildChunks path, then persisted files only)");
const persisted = await persistPackAsContext(
  { ...NORTHSTAR, commits: [] },
  repo,
);
print("northstar cold", await indexContext(repo, persisted.context.id, { skipPrune: true }));
print("northstar warm", await indexContext(repo, persisted.context.id, { skipPrune: true }));

try {
  const real = JSON.parse(readFileSync("/tmp/rdb-pack.json", "utf8"));
  const realRepo = createMemoryRepository();
  const saved = await persistPackAsContext(real, realRepo);
  console.log(`\nB. evaluation pack (${real.files.length} files)`);
  print("eval cold", await indexContext(realRepo, saved.context.id, { skipPrune: true }));
  const evalWarm = await indexContext(realRepo, saved.context.id, { skipPrune: true });
  print("eval warm", evalWarm);
  const freshChunks = buildChunks(real);
  console.log(
    `  fresh vs cached chunks equivalent: ${chunksEquivalent(freshChunks, evalWarm.chunks)}`,
  );
  const probe = "How does the Excel export actually work?";
  const freshCard = localCard(probe, retrieve(probe, freshChunks), real, 0, null);
  const warmCard = localCard(probe, retrieve(probe, evalWarm.chunks), evalWarm.pack, 0, null);
  console.log(`  probe say match: ${freshCard.say === warmCard.say}`);
  console.log(`  probe cite match: ${JSON.stringify(freshCard.citations) === JSON.stringify(warmCard.citations)}`);

  const idb = createIndexedDbRepository(`meethint-bench-${Date.now()}`);
  const idbSaved = await persistPackAsContext(real, idb);
  console.log("\nB2. evaluation pack (IndexedDB)");
  print("eval idb cold", await indexContext(idb, idbSaved.context.id, { skipPrune: true }));
  print("eval idb warm", await indexContext(idb, idbSaved.context.id, { skipPrune: true }));
} catch {
  console.log("\nB. evaluation pack skipped (no /tmp/rdb-pack.json)");
}

const sizes = [1000, 5000];
for (const n of sizes) {
  console.log(`\nC. synthetic ${n}`);
  const synRepo = createMemoryRepository();
  const saved = await persistPackAsContext(syntheticPack(n), synRepo);
  print("cold", await indexContext(synRepo, saved.context.id, { skipPrune: true }));
  print("warm 0 changed", await indexContext(synRepo, saved.context.id, { skipPrune: true }));

  const one = new Set([0]);
  await synRepo.replaceSources(saved.context.id, syntheticPack(n, one).files);
  print("1 changed", await indexContext(synRepo, saved.context.id, { skipPrune: true }));

  const ten = new Set();
  for (let i = 0; i < Math.floor(n / 10); i += 1) ten.add(i);
  await synRepo.replaceSources(saved.context.id, syntheticPack(n, ten).files);
  print("10% changed", await indexContext(synRepo, saved.context.id, { skipPrune: true }));

  const all = new Set(Array.from({ length: n }, (_, i) => i));
  await synRepo.replaceSources(saved.context.id, syntheticPack(n, all).files);
  print("100% changed", await indexContext(synRepo, saved.context.id, { skipPrune: true }));
}
