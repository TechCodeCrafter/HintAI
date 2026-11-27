import assert from "node:assert/strict";
import { test } from "node:test";

import { packFromFiles, SKIP_LABEL } from "../../repo/folder.ts";
import type { RepoPack } from "../../repo/types.ts";
import { retrieve } from "../../search/retrieve.ts";
import { INDEX_BATCH_FILES, type IndexProgress } from "../chunk-index.ts";
import {
  activityFraction,
  indexStatusView,
  namedFailures,
  type IndexActivity,
} from "../index-status.ts";
import {
  emptyIndexSummary,
  INDEX_SKIP,
  isParseFailure,
  splitSkipped,
  summarizeIndex,
  summarizeLoaded,
  type IndexSummary,
} from "../index-summary.ts";
import { createMemoryRepository } from "../memory.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { indexSpace } from "../space-index.ts";
import { isTextSource } from "../types.ts";

function fileAt(path: string, content: string, root = "acme"): File {
  const file = new File([content], path.split("/").pop() ?? path);
  Object.defineProperty(file, "webkitRelativePath", { value: `${root}/${path}`, configurable: true });
  return file;
}

const FILES: Record<string, string> = {
  "README.md": "# Acme\n\nBilling service for invoices.\n",
  "src/ledger.ts": "export function reconcileLedgerDrift() {\n  return ZEBRAFISH_TOLERANCE;\n}\n",
  "src/holds.ts": "export function sweepHolds() {\n  return NARWHAL_WINDOW;\n}\n",
  "docs/runbook.md": "# Runbook\n\nReplay from the okapi queue.\n",
  // Stored, never evidence.
  "src/types/api.d.ts": "export interface Payload {\n  id: string;\n}\n",
  // Never stored.
  "src/empty.ts": "   \n",
  "notes.xyz": "unsupported\n",
};

async function load(files = FILES) {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const reads: Array<[number, number]> = [];
  const loaded = await packFromFiles(
    Object.entries(files).map(([path, content]) => fileAt(path, content)),
    { onRead: (done, total) => reads.push([done, total]) },
  );
  const { context } = await persistPackAsContext(loaded.pack, repo);
  return { repo, context, loaded, reads };
}

function summaryOf(filesIndexed: number, chunkCount: number): IndexSummary {
  return { ...emptyIndexSummary(), filesStored: filesIndexed, filesIndexed, chunkCount };
}

test("the reader reports every candidate file, including the ones it leaves out", async () => {
  const { reads, loaded } = await load();
  const total = reads[0]?.[1] ?? 0;
  // notes.xyz is an unsupported type and never becomes a candidate.
  assert.equal(total, Object.keys(FILES).length - 1);
  assert.deepEqual(reads[0], [0, total]);
  assert.deepEqual(reads.at(-1), [total, total]);
  assert.deepEqual(
    reads.map(([done]) => done),
    Array.from({ length: total + 1 }, (_, index) => index),
  );
  // An empty file is read, counted, and left out.
  assert.ok(loaded.pack.files.length < total);
});

test("the indexer reports its own counts, from zero up to exactly what it built", async () => {
  const { repo, context } = await load();
  const seen: IndexProgress[] = [];
  const runtime = await indexSpace(repo, context.id, { embed: false, onProgress: (p) => seen.push({ ...p }) });

  const first = seen[0];
  const last = seen.at(-1);
  assert.ok(first && last);
  assert.deepEqual(first, { filesDone: 0, filesTotal: first.filesTotal, chunks: 0 });
  // Every stored file the pass handles is counted. The count moves once per
  // batch written to storage, so it never names work that was not kept.
  assert.equal(first.filesTotal, runtime.summary.filesStored);
  assert.ok(seen.every((p, index) => index === 0 || p.filesDone >= seen[index - 1].filesDone));
  assert.ok(seen.every((p, index) => index === 0 || p.filesDone - seen[index - 1].filesDone <= INDEX_BATCH_FILES));
  assert.ok(seen.every((p, index) => index === 0 || p.chunks >= seen[index - 1].chunks));
  assert.equal(last.filesDone, last.filesTotal);
  // The running chunk count ends on the number search really has.
  assert.equal(last.chunks, runtime.chunks.length);
  assert.equal(last.chunks, runtime.summary.chunkCount);

  // A second pass reads the cache and still reports each file.
  const again: IndexProgress[] = [];
  const cached = await indexSpace(repo, context.id, { embed: false, onProgress: (p) => again.push({ ...p }) });
  assert.ok(cached.report.reusedSourceCount > 0);
  assert.deepEqual(again.at(-1), last);
});

test("a space with several contexts counts across them and does not guess a total", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const pack = (name: string, count: number): RepoPack => ({
    id: `folder-${name}`,
    name,
    description: name,
    commits: [],
    files: Array.from({ length: count }, (_, index) => ({
      path: `src/${name}-${index}.ts`,
      language: "ts",
      content: `export const ${name}${index} = ${index};\n`,
    })),
  });
  const a = await persistPackAsContext(pack("auth", 2), repo);
  const b = await persistPackAsContext(pack("billing", 3), repo);
  const space = await repo.createSpace({
    name: "paired",
    memberContextIds: [a.context.id, b.context.id],
    primaryContextId: a.context.id,
  });
  const seen: IndexProgress[] = [];
  const runtime = await indexSpace(repo, space.id, { embed: false, onProgress: (p) => seen.push({ ...p }) });
  assert.ok(seen.every((p) => p.filesTotal === null));
  assert.ok(seen.every((p, index) => index === 0 || p.filesDone >= seen[index - 1].filesDone));
  assert.equal(seen.at(-1)?.filesDone, 5);
  assert.equal(seen.at(-1)?.chunks, runtime.chunks.length);
});

test("one file the chunker cannot handle is named as failed and the rest stay searchable", async () => {
  const { repo, context } = await load();
  const sources = await repo.listSources(context.id);
  const broken = sources.find((source) => source.path.endsWith("src/holds.ts"));
  assert.ok(broken && isTextSource(broken));
  // A stored row whose content is not text: the chunker throws on it.
  await repo.upsertSources(context.id, [{ ...broken, content: 12345 as unknown as string }]);

  const warn = console.warn;
  const warned: string[] = [];
  console.warn = (message: unknown) => void warned.push(String(message));
  const seen: IndexProgress[] = [];
  let runtime: Awaited<ReturnType<typeof indexSpace>>;
  try {
    runtime = await indexSpace(repo, context.id, { embed: false, onProgress: (p) => seen.push({ ...p }) });
  } finally {
    console.warn = warn;
  }

  // The other files are indexed and found.
  assert.ok(retrieve("ZEBRAFISH_TOLERANCE", runtime.chunks, 3)[0]?.path.endsWith("src/ledger.ts"));
  assert.ok(!runtime.chunks.some((chunk) => chunk.path.endsWith("src/holds.ts")));
  assert.ok(warned.some((line) => line.includes("src/holds.ts")));
  // It still counts as handled, so the progress reaches the end.
  assert.equal(seen.at(-1)?.filesDone, seen.at(-1)?.filesTotal);

  const { failed, left } = splitSkipped(runtime.summary.skipped);
  assert.deepEqual(
    failed.map((item) => [item.path.split("/").slice(1).join("/"), item.reason, item.failed]),
    [["src/holds.ts", INDEX_SKIP.unknown, true]],
  );
  // The declaration file is left out by a rule. That is not a failure.
  assert.ok(left.some((item) => item.path.endsWith("api.d.ts") && item.reason === INDEX_SKIP.tooling));
  assert.equal(runtime.summary.filesIndexed, runtime.summary.filesStored - failed.length - left.length);

  // The screen recounts from what the store holds and reaches the same answer.
  const recount = summarizeLoaded(await repo.listSources(context.id), runtime.pack, runtime.chunks);
  assert.deepEqual(
    splitSkipped(recount.skipped).failed.map((item) => item.path),
    failed.map((item) => item.path),
  );
});

test("a failure is a file meant to be indexed; a file skipped by a rule is not", () => {
  const summary = summarizeIndex(
    [
      { kind: "file", path: "docs/private.md", content: "secret\n" },
      { kind: "file", path: "src/blank.ts", content: "  \n" },
      { kind: "file", path: "src/lost.ts", content: "export const lost = 1;\n" },
      { kind: "pdf", path: "scan.pdf", sourceId: "pdf-1", readiness: "scanned" },
      { kind: "pdf", path: "broken.pdf", sourceId: "pdf-2", readiness: "unreadable" },
      { kind: "pdf", path: "huge.pdf", sourceId: "pdf-3", readiness: "refused" },
      { kind: "pdf", path: "slow.pdf", sourceId: "pdf-4", readiness: "pending" },
      { kind: "pdf", path: "hollow.pdf", sourceId: "pdf-5", readiness: "ready" },
    ],
    [],
    ["docs/*.md"],
  );
  const { failed, left } = splitSkipped([
    ...summary.skipped,
    { path: "deck.pptx", reason: SKIP_LABEL.failed },
    { path: "node_modules/", reason: SKIP_LABEL.vendor, count: 40 },
    { path: "big.json", reason: SKIP_LABEL.json },
  ]);
  assert.deepEqual(
    failed.map((item) => item.path).sort(),
    ["broken.pdf", "deck.pptx", "hollow.pdf", "scan.pdf", "src/lost.ts"],
  );
  assert.deepEqual(
    left.map((item) => item.path).sort(),
    ["big.json", "docs/private.md", "huge.pdf", "node_modules/", "slow.pdf", "src/blank.ts"],
  );
  assert.equal(isParseFailure({ path: "a", reason: SKIP_LABEL.failed }), true);
  assert.equal(isParseFailure({ path: "a", reason: SKIP_LABEL.size }), false);
});

test("the status line follows a load and only says Ready for a finished index with chunks", () => {
  const idle = { working: false, errored: false, activity: null };
  const during = (activity: IndexActivity | null, extra = {}) =>
    indexStatusView({ working: true, errored: false, activity, summary: summaryOf(3, 9), ...extra });

  assert.equal(during({ phase: "reading", done: 120, total: 480 }).text, "Reading 120 of 480 files…");
  assert.equal(during({ phase: "saving", total: 1 }).text, "Saving 1 file…");
  assert.equal(
    during({ phase: "indexing", done: 1200, total: 4800, chunks: 19300 }).text,
    "Indexing 1,200 of 4,800 files, 19,300 chunks so far…",
  );
  assert.equal(
    during({ phase: "indexing", done: 1, total: null, chunks: 1 }).text,
    "Indexing 1 file, 1 chunk so far…",
  );
  assert.equal(during(null).text, "Indexing…");
  assert.equal(during(null, { booting: true }).text, "Loading…");
  assert.equal(during(null, { pdf: { phase: "reading", current: 2, total: 3 } }).text, "Reading PDF 2 of 3…");
  assert.equal(during(null, { pdf: { phase: "reading", current: 1, total: 1 } }).text, "Reading PDF…");
  // A load in progress never reads as finished, whatever the old index holds.
  for (const view of [during(null), during({ phase: "indexing", done: 3, total: 3, chunks: 9 })]) {
    assert.equal(view.state, "working");
    assert.doesNotMatch(view.text, /Ready/);
  }

  const ready = indexStatusView({ ...idle, summary: summaryOf(480, 2104) });
  assert.deepEqual(ready, { state: "ready", text: "Indexed 480 files, 2,104 chunks. Ready.", fraction: null });
  assert.equal(
    indexStatusView({ ...idle, summary: summaryOf(1, 1) }).text,
    "Indexed 1 file, 1 chunk. Ready.",
  );

  const empty = indexStatusView({ ...idle, summary: summaryOf(0, 0) });
  assert.equal(empty.state, "empty");
  assert.equal(empty.text, "Indexed 0 files, 0 chunks. Nothing to search yet.");

  const failed = indexStatusView({ ...idle, errored: true, summary: summaryOf(0, 0) });
  assert.deepEqual([failed.state, failed.text], ["error", "Indexing did not finish."]);
  const kept = indexStatusView({ ...idle, errored: true, summary: summaryOf(4, 12) });
  assert.equal(kept.text, "Indexing did not finish. Indexed 4 files, 12 chunks.");
  for (const view of [empty, failed, kept]) assert.doesNotMatch(view.text, /Ready/);
});

test("the bar only moves forward through one load and is not drawn when there is nothing to measure", () => {
  const steps: IndexActivity[] = [
    { phase: "reading", done: 0, total: 40 },
    { phase: "reading", done: 20, total: 40 },
    { phase: "reading", done: 40, total: 40 },
    { phase: "saving", total: 38 },
    { phase: "indexing", done: 0, total: 38, chunks: 0 },
    { phase: "indexing", done: 19, total: 38, chunks: 60 },
    { phase: "indexing", done: 38, total: 38, chunks: 120 },
  ];
  const fractions = steps.map((step) => activityFraction(step));
  assert.equal(fractions[0], 0);
  assert.equal(fractions.at(-1), 1);
  for (let index = 1; index < fractions.length; index += 1) {
    assert.ok((fractions[index] ?? 0) >= (fractions[index - 1] ?? 0), `step ${index} went backwards`);
  }
  assert.equal(activityFraction(null), null);
  assert.equal(activityFraction({ phase: "indexing", done: 4, total: null, chunks: 9 }), null);
  // An empty selection does not divide by zero.
  assert.equal(activityFraction({ phase: "reading", done: 0, total: 0 }), 0);
});

test("failed files are named: the first one, then how many more", () => {
  assert.equal(namedFailures([]), "");
  assert.equal(namedFailures(["acme/docs/deck.pptx"]), "deck.pptx");
  assert.equal(namedFailures(["acme/docs/deck.pptx", "a.pdf", "b.pdf"]), "deck.pptx and 2 more");
  assert.equal(namedFailures(["acme/locked/"]), "locked");
});
