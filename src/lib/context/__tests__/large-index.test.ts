import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import "fake-indexeddb/auto";

import Dexie from "dexie";

import { readDrop, type DropSource } from "../../repo/drop-entries.ts";
import { scanFileList, SKIP_LABEL } from "../../repo/folder.ts";
import type { RepoPack } from "../../repo/types.ts";
import { retrieve } from "../../search/retrieve.ts";
import { FILE_ROW_HEIGHT, OVERSCAN, rowWindow } from "../../ui/row-window.ts";
import { chunksEquivalent, INDEX_BATCH_FILES, indexContext } from "../chunk-index.ts";
import { CHUNKER_VERSION } from "../index-versions.ts";
import { createMemoryRepository } from "../memory.ts";
import type { ContextRepository } from "../repository.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { createIndexedDbRepository } from "../storage/indexeddb.ts";

const FILES = 130;

function bigPack(count = FILES): RepoPack {
  return {
    id: "big",
    name: "big",
    description: "big",
    commits: [],
    files: Array.from({ length: count }, (_, index) => ({
      path: `src/mod${String(index).padStart(3, "0")}.ts`,
      language: "ts",
      content: [
        `/** Module ${index}: handles one request. */`,
        `export function handler${index}() {`,
        `  return "TOKEN_${index}_ONLY";`,
        `}`,
        ``,
        `/** Retries the handler of module ${index}. */`,
        `export function retry${index}(attempts: number) {`,
        `  for (let i = 0; i < attempts; i += 1) handler${index}();`,
        `}`,
        ``,
        `/** Settings of module ${index}. */`,
        `export class Settings${index} {`,
        `  timeoutMs = ${1000 + index};`,
        `}`,
        ``,
      ].join("\n"),
    })),
  };
}

afterEach(() => {
  setContextRepository(null);
});

/** Counts calls so a test can tell one write per batch from one per file. */
function counting(repo: ContextRepository) {
  const calls = { single: 0, batch: 0, batchSizes: [] as number[], reads: 0, readMany: 0 };
  const wrapped: ContextRepository = {
    ...repo,
    writeIndexed: (record, chunks) => {
      calls.single += 1;
      return repo.writeIndexed(record, chunks);
    },
    writeIndexedBatch: (entries) => {
      calls.batch += 1;
      calls.batchSizes.push(entries.length);
      return repo.writeIndexedBatch!(entries);
    },
    readIndexedChunks: (contextId, sourceId, contentHash) => {
      calls.reads += 1;
      return repo.readIndexedChunks(contextId, sourceId, contentHash);
    },
    readIndexedChunksMany: (contextId, sourceIds) => {
      calls.readMany += 1;
      return repo.readIndexedChunksMany!(contextId, sourceIds);
    },
  };
  return { repo: wrapped, calls };
}

for (const [label, make] of [
  ["memory", () => createMemoryRepository() as ContextRepository],
  ["IndexedDB", () => createIndexedDbRepository(`meethint-large-${crypto.randomUUID()}`) as ContextRepository],
] as const) {
  test(`${label}: a large folder is written and read back a batch at a time`, async () => {
    const { repo, calls } = counting(make());
    const { context } = await persistPackAsContext(bigPack(), repo);
    const first = await indexContext(repo, context.id, { embed: false });
    assert.equal(first.report.rebuiltSourceCount, FILES);
    assert.equal(calls.single, 0);
    assert.equal(calls.batch, Math.ceil(FILES / INDEX_BATCH_FILES));
    assert.deepEqual(calls.batchSizes, [40, 40, 40, 10]);

    const second = await indexContext(repo, context.id, { embed: false });
    assert.equal(second.report.reusedSourceCount, FILES);
    assert.equal(second.report.rebuiltSourceCount, 0);
    assert.equal(calls.reads, 0);
    assert.equal(calls.readMany, Math.ceil(FILES / INDEX_BATCH_FILES));
    assert.ok(chunksEquivalent(first.chunks, second.chunks));
    // Every file is reachable by the string only it holds.
    for (const index of [0, 39, 40, 99, FILES - 1]) {
      assert.equal(retrieve(`TOKEN_${index}_ONLY`, second.chunks, 3)[0]?.path, `big/src/mod${String(index).padStart(3, "0")}.ts`);
    }
  });

  test(`${label}: a cancelled pass keeps the batches it finished, and the next pass builds only the rest`, async () => {
    const repo = make();
    const { context } = await persistPackAsContext(bigPack(), repo);
    const seen: number[] = [];
    let cancel = false;
    const stopped = await indexContext(repo, context.id, {
      embed: false,
      isCancelled: () => cancel,
      onProgress: (progress) => {
        seen.push(progress.filesDone);
        // Asked to stop once the second batch is on record.
        if (progress.filesDone >= 2 * INDEX_BATCH_FILES) cancel = true;
      },
    });
    assert.equal(stopped.cancelled, true);
    assert.deepEqual(seen, [0, 40, 80]);
    assert.equal((await repo.listIndexed(context.id)).length, 80);

    const resumed = await indexContext(repo, context.id, { embed: false });
    assert.equal(resumed.cancelled, false);
    assert.equal(resumed.report.reusedSourceCount, 80);
    assert.equal(resumed.report.rebuiltSourceCount, FILES - 80);
    assert.equal(resumed.summary.filesIndexed, FILES);

    const fresh = make();
    const again = await persistPackAsContext(bigPack(), fresh);
    const whole = await indexContext(fresh, again.context.id, { embed: false });
    assert.equal(resumed.chunks.length, whole.chunks.length);
    assert.deepEqual(
      resumed.chunks.map((chunk) => [chunk.path, chunk.text]),
      whole.chunks.map((chunk) => [chunk.path, chunk.text]),
    );
  });
}

test("a pass cancelled inside a batch still writes what that batch had built", async () => {
  const repo = createMemoryRepository();
  const { context } = await persistPackAsContext(bigPack(), repo);
  let asked = 0;
  const stopped = await indexContext(repo, context.id, {
    embed: false,
    // Once per batch, then once per file: true from the 26th question on.
    isCancelled: () => (asked += 1) > 26,
  });
  assert.equal(stopped.cancelled, true);
  const kept = (await repo.listIndexed(context.id)).length;
  assert.ok(kept > 0 && kept < INDEX_BATCH_FILES, `kept ${kept}`);
  const resumed = await indexContext(repo, context.id, { embed: false });
  assert.equal(resumed.report.reusedSourceCount, kept);
  assert.equal(resumed.report.rebuiltSourceCount, FILES - kept);
});

test("IndexedDB keeps a text file's chunks in one row, and still reads the rows written before", async () => {
  const name = `meethint-rows-${crypto.randomUUID()}`;
  const repo = createIndexedDbRepository(name);
  const small = bigPack(12);
  // Long enough that each file is cut into several chunks.
  const long: RepoPack = {
    ...small,
    files: small.files.map((file, index) => ({
      ...file,
      content: Array.from({ length: 6 }, (_, part) =>
        [
          `/** Step ${part} of module ${index}. */`,
          `export function step${index}_${part}(input: number) {`,
          ...Array.from({ length: 30 }, (_, line) => `  const v${line} = input + ${line + part};`),
          `  return v0;`,
          `}`,
          ``,
        ].join("\n"),
      ).join("\n"),
    })),
  };
  const { context } = await persistPackAsContext(long, repo);
  const first = await indexContext(repo, context.id, { embed: false });
  assert.ok(first.chunks.length > 12, "more than one chunk per file");

  const raw = new Dexie(name);
  await raw.open();
  const perFile = raw.table("sourceChunks");
  const perChunk = raw.table("storedChunks");
  assert.equal(await perFile.count(), 12);
  assert.equal(await perChunk.count(), 0);

  // Put the chunks back the way an older build stored them: a row per chunk.
  const rows = await perFile.toArray();
  await perChunk.bulkAdd(
    rows.flatMap((row) =>
      (row.chunks as { id: string }[]).map((chunk, ordinal) => ({
        id: `${row.contextId}:${row.sourceId}:${chunk.id}`,
        workspaceId: row.workspaceId,
        contextId: row.contextId,
        sourceId: row.sourceId,
        ordinal,
        schemaVersion: row.schemaVersion,
        chunk,
      })),
    ),
  );
  await perFile.clear();
  raw.close();

  const reopened = createIndexedDbRepository(name);
  const legacy = await indexContext(reopened, context.id, { embed: false });
  assert.equal(legacy.report.reusedSourceCount, 12);
  assert.equal(legacy.report.rebuiltSourceCount, 0);
  assert.ok(chunksEquivalent(first.chunks, legacy.chunks));

  // A file that is chunked again moves to the new table and leaves no old rows.
  const rebuilt = await indexContext(reopened, context.id, { embed: false, chunkerVersion: CHUNKER_VERSION + 1 });
  assert.equal(rebuilt.report.rebuiltSourceCount, 12);
  const after = new Dexie(name);
  await after.open();
  assert.equal(await after.table("sourceChunks").count(), 12);
  assert.equal(await after.table("storedChunks").count(), 0);

  // Removing a file's index removes its row; removing the context's removes them all.
  const sources = await reopened.listSources(context.id);
  await reopened.deleteIndexed(context.id, [sources[0].id]);
  assert.equal(await after.table("sourceChunks").count(), 11);
  assert.equal(await reopened.readIndexedChunks(context.id, sources[0].id), null);
  await reopened.deleteIndexed(context.id);
  assert.equal(await after.table("sourceChunks").count(), 0);
  after.close();
});

function fileAt(path: string, content = "x\n"): File {
  const name = path.split("/").pop() ?? path;
  const file = new File([content], name, { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", { value: `repo/${path}`, configurable: true });
  return file;
}

test("a selected folder lists each vendor folder once, with how many files it held", () => {
  const scan = scanFileList([
    fileAt("src/a.ts", "export const a = 1\n"),
    ...Array.from({ length: 300 }, (_, index) => fileAt(`node_modules/pkg${index}/index.js`)),
    ...Array.from({ length: 7 }, (_, index) => fileAt(`packages/web/dist/chunk${index}.js`)),
  ]);
  const vendor = (scan.skippedFiles ?? []).filter((item) => item.reason === SKIP_LABEL.vendor);
  assert.deepEqual(
    vendor.sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: "node_modules/", reason: SKIP_LABEL.vendor, count: 300 },
      { path: "packages/web/dist/", reason: SKIP_LABEL.vendor, count: 7 },
    ],
  );
});

test("a drop larger than one scan reads says so in the list of skipped files", async () => {
  const entry = (name: string) => ({
    isFile: true,
    isDirectory: false,
    name,
    file: (ok: (file: File) => void) => ok(new File(["x"], name)),
  });
  let handed = 0;
  const TOTAL = 20_050;
  const root = {
    isFile: false,
    isDirectory: true,
    name: "huge",
    createReader: () => ({
      readEntries: (ok: (batch: unknown[]) => void) => {
        const batch = Array.from({ length: Math.min(500, TOTAL - handed) }, (_, index) => entry(`f${handed + index}.ts`));
        handed += batch.length;
        ok(batch);
      },
    }),
  };
  const dropped = await readDrop({
    items: [{ kind: "file", webkitGetAsEntry: () => root }],
  } as unknown as DropSource);
  assert.equal(dropped.capped, true);
  assert.equal(dropped.files.length, 20_000);
  assert.deepEqual(dropped.skippedFiles, [
    { path: "everything after the first 20,000 files", reason: SKIP_LABEL.walk },
  ]);
  assert.ok(dropped.skipLabels.includes(SKIP_LABEL.walk));
});

test("a long file list draws the rows on screen and a few either side", () => {
  assert.deepEqual(rowWindow(0, 480, 5000), { start: 0, end: 10 + OVERSCAN });
  const middle = rowWindow(1000 * FILE_ROW_HEIGHT, 480, 5000);
  assert.deepEqual(middle, { start: 1000 - OVERSCAN, end: 1010 + OVERSCAN });
  // The last screen stops at the last row, and a short list is drawn whole.
  assert.deepEqual(rowWindow(4990 * FILE_ROW_HEIGHT, 480, 5000), { start: 4990 - OVERSCAN, end: 5000 });
  assert.deepEqual(rowWindow(0, 480, 3), { start: 0, end: 3 });
  // Scrolled past the end (the list just got shorter): nothing, not a negative range.
  const past = rowWindow(9000 * FILE_ROW_HEIGHT, 480, 100);
  assert.ok(past.start <= past.end && past.end === 100);
});
