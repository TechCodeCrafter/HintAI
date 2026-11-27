import assert from "node:assert/strict";
import { test } from "node:test";

import { packFromFiles, SKIP_LABEL, type SkippedFile } from "../../repo/folder.ts";
import { indexChipView } from "../index-status.ts";
import {
  emptyIndexSummary,
  groupSkipped,
  mergeNotLoaded,
  NOT_LOADED_NAMED,
  NOT_LOADED_REST,
  skippedFileCount,
  splitSkipped,
  type IndexSummary,
} from "../index-summary.ts";
import { createMemoryRepository } from "../memory.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { indexSpace } from "../space-index.ts";

function fileAt(path: string, content: string, root = "acme"): File {
  const file = new File([content], path.split("/").pop() ?? path);
  Object.defineProperty(file, "webkitRelativePath", { value: `${root}/${path}`, configurable: true });
  return file;
}

function summaryOf(filesIndexed: number, chunkCount: number, filesStored = filesIndexed): IndexSummary {
  return { ...emptyIndexSummary(), filesStored, filesIndexed, chunkCount };
}

const IDLE = { working: false, errored: false, activity: null } as const;

test("the chip reads as the ticket asks: files, skipped, chunks, with thousands separators", () => {
  const view = indexChipView({ ...IDLE, summary: summaryOf(142, 18400, 143), skipped: 3, failed: 0 });
  assert.equal(view.text, "Indexed 142 files · 3 skipped · 18,400 chunks");
  assert.equal(view.state, "ready");
  assert.equal(view.settled, true);
  assert.equal(view.attention, false);
});

test("the chip always states the skipped count, zero included, and uses singular nouns for one", () => {
  assert.equal(
    indexChipView({ ...IDLE, summary: summaryOf(1, 1), skipped: 0, failed: 0 }).text,
    "Indexed 1 file · 0 skipped · 1 chunk",
  );
  assert.equal(
    indexChipView({ ...IDLE, summary: summaryOf(1204, 9, 1204), skipped: 12040, failed: 0 }).text,
    "Indexed 1,204 files · 12,040 skipped · 9 chunks",
  );
});

test("a file that failed to parse asks for attention; a file skipped by a rule does not", () => {
  const summary = summaryOf(10, 20, 11);
  assert.equal(indexChipView({ ...IDLE, summary, skipped: 1, failed: 1 }).attention, true);
  assert.equal(indexChipView({ ...IDLE, summary, skipped: 1, failed: 0 }).attention, false);
});

test("while a load runs the chip shows the step in progress and never a skipped count", () => {
  const summary = summaryOf(3, 9, 40);
  const reading = indexChipView({
    working: true,
    errored: false,
    activity: { phase: "reading", done: 120, total: 480 },
    summary,
    // Files not reached yet have no chunks; counting them as skipped would be wrong.
    skipped: 37,
    failed: 37,
  });
  assert.equal(reading.text, "Reading 120 of 480 files…");
  assert.equal(reading.state, "working");
  assert.equal(reading.settled, false);
  assert.equal(reading.attention, false);
  assert.doesNotMatch(reading.text, /skipped/);

  const indexing = indexChipView({
    working: true,
    errored: false,
    activity: { phase: "indexing", done: 120, total: 480, chunks: 1930 },
    summary,
    skipped: 0,
    failed: 0,
  });
  assert.equal(indexing.text, "Indexing 120 of 480 files, 1,930 chunks so far…");
});

test("an empty or failed index is never dressed up as a finished one", () => {
  const nothing = indexChipView({ ...IDLE, summary: summaryOf(0, 0), skipped: 0, failed: 0 });
  assert.equal(nothing.text, "Nothing indexed yet");
  assert.equal(nothing.state, "empty");
  assert.equal(nothing.attention, false);

  // Files were selected and every one was left out.
  const allSkipped = indexChipView({ ...IDLE, summary: summaryOf(0, 0), skipped: 4, failed: 0 });
  assert.equal(allSkipped.text, "Indexed 0 files · 4 skipped · 0 chunks");
  assert.equal(allSkipped.state, "empty");
  assert.equal(allSkipped.attention, true);

  const errored = indexChipView({ ...IDLE, errored: true, summary: summaryOf(0, 0), skipped: 0, failed: 0 });
  assert.equal(errored.text, "Indexing did not finish");
  assert.equal(errored.state, "error");
  const partial = indexChipView({ ...IDLE, errored: true, summary: summaryOf(5, 12), skipped: 2, failed: 0 });
  assert.equal(partial.text, "Indexing did not finish · Indexed 5 files · 2 skipped · 12 chunks");
  assert.equal(partial.attention, true);
});

const skip = (path: string, reason: string = SKIP_LABEL.types, extra: Partial<SkippedFile> = {}): SkippedFile => ({
  path,
  reason,
  ...extra,
});

test("files left out of an earlier load stay listed when more files are added", () => {
  const first = mergeNotLoaded([], [skip("a.bin", SKIP_LABEL.binaries), skip("b.xyz")], "acme", ["README.md"]);
  assert.deepEqual(
    first.map((item) => [item.root, item.path]),
    [
      ["acme", "a.bin"],
      ["acme", "b.xyz"],
    ],
  );
  // A loose file added later belongs to another selection and removes nothing.
  const second = mergeNotLoaded(first, [skip("c.xyz")], "local-repo", ["notes.md"]);
  assert.deepEqual(
    second.map((item) => [item.root, item.path]),
    [
      ["acme", "a.bin"],
      ["acme", "b.xyz"],
      ["local-repo", "c.xyz"],
    ],
  );
  assert.equal(skippedFileCount(second), 3);
});

test("loading the same folder again does not count its skipped files twice", () => {
  const skipped = [skip("a.bin", SKIP_LABEL.binaries), skip("vendor/", SKIP_LABEL.vendor, { count: 40 })];
  const once = mergeNotLoaded([], skipped, "acme");
  const twice = mergeNotLoaded(once, skipped, "acme");
  assert.deepEqual(twice, once);
  assert.equal(skippedFileCount(twice), 41);
});

test("a file left out before and loaded now is no longer listed, in its own folder only", () => {
  const before = [
    ...mergeNotLoaded([], [skip("src/big.json", SKIP_LABEL.json), skip("b.xyz")], "acme"),
    ...mergeNotLoaded([], [skip("src/big.json", SKIP_LABEL.json)], "other"),
  ];
  const after = mergeNotLoaded(before, [], "acme", ["src/big.json"]);
  assert.deepEqual(
    after.map((item) => [item.root, item.path]),
    [
      ["acme", "b.xyz"],
      ["other", "src/big.json"],
    ],
  );
});

test("a file left out twice keeps the latest reason", () => {
  const before = mergeNotLoaded([], [skip("src/big.json", SKIP_LABEL.cap)], "acme");
  const after = mergeNotLoaded(before, [skip("src/big.json", SKIP_LABEL.json)], "acme");
  assert.deepEqual(after, [{ path: "src/big.json", reason: SKIP_LABEL.json, root: "acme" }]);
});

test("every file over a limit is kept by name, however many there are", () => {
  const over = Array.from({ length: NOT_LOADED_NAMED + 60 }, (_, index) => skip(`src/f${index}.ts`, SKIP_LABEL.cap));
  const sized = Array.from({ length: 30 }, (_, index) => skip(`data/d${index}.csv`, SKIP_LABEL.total));
  const stored = mergeNotLoaded([], [...over, ...sized], "acme");
  assert.equal(stored.length, NOT_LOADED_NAMED + 90);
  assert.equal(stored.some((item) => item.path === NOT_LOADED_REST), false);
  assert.deepEqual(
    groupSkipped(stored).map((group) => [group.reason, group.files.length]),
    [
      [SKIP_LABEL.cap, NOT_LOADED_NAMED + 60],
      [SKIP_LABEL.total, 30],
    ],
  );
});

test("a long list is stored short and still adds up to the exact count", () => {
  const many = Array.from({ length: NOT_LOADED_NAMED + 60 }, (_, index) => skip(`src/f${index}.png`, SKIP_LABEL.binaries));
  const folder = skip("node_modules/", SKIP_LABEL.vendor, { count: 900 });
  const unread = skip("locked.docx", SKIP_LABEL.failed);
  const stored = mergeNotLoaded([], [...many, folder, unread], "acme");

  assert.equal(stored.length, NOT_LOADED_NAMED + 3);
  assert.equal(skippedFileCount(stored), NOT_LOADED_NAMED + 60 + 900 + 1);
  const rest = stored.filter((item) => item.path === NOT_LOADED_REST);
  assert.deepEqual(rest, [{ path: NOT_LOADED_REST, reason: SKIP_LABEL.binaries, count: 60, root: "acme" }]);
  // A file that could not be read is still told apart from one skipped by a rule.
  assert.deepEqual(
    splitSkipped(stored).failed.map((item) => item.path),
    ["locked.docx"],
  );

  // A skipped folder that is counted and not named still counts every file in it.
  const folders = Array.from({ length: NOT_LOADED_NAMED + 5 }, (_, index) =>
    skip(`packages/p${index}/node_modules/`, SKIP_LABEL.vendor, { count: 3 }),
  );
  assert.equal(skippedFileCount(mergeNotLoaded([], folders, "mono")), (NOT_LOADED_NAMED + 5) * 3);

  // The same folder loaded again: the counted files are recounted, not added.
  const again = mergeNotLoaded(stored, [...many, folder, unread], "acme");
  assert.equal(skippedFileCount(again), skippedFileCount(stored));
  // A small add from another selection keeps the count that has no paths.
  const added = mergeNotLoaded(stored, [skip("x.xyz")], "local-repo");
  assert.equal(skippedFileCount(added), skippedFileCount(stored) + 1);
});

const FILES: Record<string, string> = {
  "README.md": "# Acme\n\nBilling service for invoices.\n",
  "src/ledger.ts": "export function reconcileLedgerDrift() {\n  return ZEBRAFISH_TOLERANCE;\n}\n",
  // Never stored.
  "src/empty.ts": "   \n",
  "notes.xyz": "unsupported\n",
};

async function loadInto(
  repo: ReturnType<typeof createMemoryRepository>,
  files: Record<string, string>,
  options: { contextId?: string; root?: string } = {},
) {
  const loaded = await packFromFiles(
    Object.entries(files).map(([path, content]) => fileAt(path, content, options.root)),
  );
  const { context } = await persistPackAsContext(loaded.pack, repo, {
    contextId: options.contextId,
    notLoaded: loaded.skippedFiles,
  });
  return { context, loaded };
}

test("files left out at load are stored with the space and come back when it is opened again", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context, loaded } = await loadInto(repo, FILES);
  assert.equal(loaded.skippedFiles.length, 2);

  // Opening the space reads the list from storage, not from the load that made it.
  const runtime = await indexSpace(repo, context.id, { embed: false });
  assert.deepEqual(
    runtime.notLoaded.map((item) => [item.path, item.reason]).sort(),
    [
      ["notes.xyz", SKIP_LABEL.types],
      ["src/empty.ts", SKIP_LABEL.empty],
    ],
  );
  const total = skippedFileCount(runtime.notLoaded) + skippedFileCount(runtime.summary.skipped);
  assert.equal(
    indexChipView({ ...IDLE, summary: runtime.summary, skipped: total, failed: 0 }).text,
    `Indexed 2 files · 2 skipped · ${runtime.chunks.length} chunks`,
  );
});

test("adding a file mid-session keeps the earlier skipped files and moves the counts", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await loadInto(repo, FILES);
  const before = await indexSpace(repo, context.id, { embed: false });

  await loadInto(
    repo,
    { "docs/runbook.md": "# Runbook\n\nReplay from the okapi queue.\n", "trace.bin2": "x\n" },
    { contextId: context.id, root: "extra" },
  );
  const after = await indexSpace(repo, context.id, { embed: false });

  assert.equal(after.summary.filesIndexed, before.summary.filesIndexed + 1);
  assert.ok(after.summary.chunkCount > before.summary.chunkCount);
  assert.deepEqual(after.notLoaded.map((item) => `${item.root}:${item.path}`).sort(), [
    "acme:notes.xyz",
    "acme:src/empty.ts",
    "extra:trace.bin2",
  ]);
});

test("a load that passes no list leaves the stored one alone, and an emptied context starts again", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context, loaded } = await loadInto(repo, FILES);
  // A caller that knows nothing about skipped files (a migration, a harness).
  await persistPackAsContext(loaded.pack, repo, { contextId: context.id });
  assert.equal((await repo.getContext(context.id))?.notLoaded?.length, 2);

  const sources = await repo.listSources(context.id);
  await repo.deleteSources(
    context.id,
    sources.map((source) => source.id),
  );
  const emptied = await indexSpace(repo, context.id, { embed: false }).catch(() => null);
  // With nothing stored there is nothing the list could describe.
  assert.deepEqual(emptied?.notLoaded ?? [], []);

  await loadInto(repo, { "README.md": "# Fresh\n\nNew start.\n" }, { contextId: context.id, root: "fresh" });
  assert.deepEqual((await repo.getContext(context.id))?.notLoaded ?? [], []);
});

test("a file left out of one load and stored by the next is dropped from the stored list", async () => {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const pack = (paths: string[]) => ({
    id: "folder-acme",
    name: "acme",
    description: "acme",
    commits: [],
    files: paths.map((path) => ({ path, language: "md", content: `# ${path}\n\nSome text about ${path}.\n` })),
  });
  const { context } = await persistPackAsContext(pack(["README.md"]), repo, {
    notLoaded: [skip("docs/late.md", SKIP_LABEL.cap), skip("logo.png", SKIP_LABEL.binaries)],
  });
  await persistPackAsContext(pack(["docs/late.md"]), repo, { contextId: context.id, notLoaded: [] });
  assert.deepEqual(
    (await repo.getContext(context.id))?.notLoaded?.map((item) => item.path),
    ["logo.png"],
  );
});
