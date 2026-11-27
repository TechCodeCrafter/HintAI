import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import {
  packFromFiles,
  packFromScan,
  prunePack,
  scanDirectoryHandle,
  scanFileList,
  SKIP_LABEL,
  type DirectoryLike,
  type FolderLoad,
  type FsEntry,
} from "../../repo/folder.ts";
import { isLimitReason } from "../../repo/limits.ts";
import type { RepoPack } from "../../repo/types.ts";
import { buildChunks, retrieve } from "../../search/retrieve.ts";
import { indexContext } from "../chunk-index.ts";
import {
  formatIndexSummary,
  groupSkipped,
  INDEX_SKIP,
  reportIndexSummary,
  skippedFileCount,
  summarizeIndex,
  summarizeLoaded,
  type IndexDebugRecord,
} from "../index-summary.ts";
import { indexedSourceKey } from "../index-types.ts";
import { CHUNKER_VERSION, RETRIEVAL_INDEX_VERSION } from "../index-versions.ts";
import { createMemoryRepository } from "../memory.ts";
import { persistPackAsContext, setContextRepository } from "../service.ts";
import { indexSpace } from "../space-index.ts";
import { isTextSource } from "../types.ts";

/**
 * A small repo shaped like a real one: a README, source in known and unknown
 * languages and folders, config, tests, tooling and files that cannot be read.
 * Each indexable file holds one string no other file contains.
 */
const REPO: Record<string, { content: string; unique?: string }> = {
  "README.md": { content: "# Acme Billing\n\nBilling service for invoices.\n", unique: "invoices" },
  "src/ledger/reconcile.ts": {
    content: "/** Reconciles ledger drift. */\nexport function reconcileLedgerDrift() {\n  return ZEBRAFISH_TOLERANCE;\n}\n",
    unique: "ZEBRAFISH_TOLERANCE",
  },
  "worker/jobs.py": { content: 'def run_narwhal_sweep():\n    """Sweeps stale holds."""\n    return 1\n', unique: "run_narwhal_sweep" },
  "openapi.yaml": {
    content: "openapi: 3.0.0\npaths:\n  /v1/axolotl-refunds:\n    post:\n      summary: Create a refund\n",
    unique: "axolotl-refunds",
  },
  "docker-compose.yml": { content: "services:\n  pangolin-cache:\n    image: redis:7\n", unique: "pangolin-cache" },
  "package.json": {
    content: '{\n  "name": "acme-billing",\n  "scripts": { "ocelot-migrate": "node migrate.js" }\n}\n',
    unique: "ocelot-migrate",
  },
  "config/limits.json": { content: '{ "capybaraBurstLimit": 40 }\n', unique: "capybaraBurstLimit" },
  "db/schema.sql": { content: "CREATE TABLE wombat_settlements (id uuid primary key);\n", unique: "wombat_settlements" },
  "e2e/checkout.spec.ts": { content: "test('ibex checkout completes', async () => {});\n", unique: "ibex" },
  "tests/test_holds.py": { content: "def test_marmot_hold_expires():\n    assert True\n", unique: "test_marmot_hold_expires" },
  "plugins/tax/includes/classes/rates/VatRates.php": {
    content: "<?php\nclass VatRates { const TAPIR_RATE = 0.2; }\n",
    unique: "TAPIR_RATE",
  },
  "web/components/forms/inputs/Amount.vue": {
    content: '<template><input class="lemur-amount" /></template>\n',
    unique: "lemur-amount",
  },
  "notes/2024/q1/planning/roadmap.md": { content: "# Roadmap\n\nShip the okapi exporter in March.\n", unique: "okapi" },
  "scripts/deploy.sh": { content: "#!/bin/sh\necho deploying kinkajou-stack\n", unique: "kinkajou-stack" },
  // Stored, but never evidence.
  "src/types/api.d.ts": { content: "export interface QuokkaInvoicePayload {\n  id: string;\n}\n" },
  ".storybook/main.ts": { content: "export default { framework: 'numbat-vite' };\n" },
  // Never stored.
  "generated/client.ts": { content: "export const dugongClient = {};\n" },
  "src/empty.ts": { content: "   \n" },
  "assets/logo.png": { content: "\u0000\u0001binary" },
  "notes.xyz": { content: "unsupported type vicuna\n" },
};

const SEARCHABLE = Object.entries(REPO).filter(([, file]) => file.unique);

function fileAt(path: string, content: string, root: string): File {
  const file = new File([content], path.split("/").pop() ?? path);
  Object.defineProperty(file, "webkitRelativePath", { value: `${root}/${path}`, configurable: true });
  return file;
}

async function loadAndIndex(root = "acme-billing", files = REPO) {
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const load = await packFromFiles(Object.entries(files).map(([path, file]) => fileAt(path, file.content, root)));
  const { context } = await persistPackAsContext(load.pack, repo);
  const runtime = await indexSpace(repo, context.id, { embed: false });
  return { repo, context, load, runtime };
}

afterEach(() => {
  delete process.env.DEBUG_SEARCH;
  delete (globalThis as { __meethintIndexDebug?: IndexDebugRecord[] }).__meethintIndexDebug;
});

test("every file a folder load keeps is chunked and found by a string only it contains", async () => {
  const { runtime } = await loadAndIndex();
  const missed: string[] = [];
  for (const [path, file] of SEARCHABLE) {
    const top = retrieve(file.unique ?? "", runtime.chunks, 6)[0];
    if (!top?.path.endsWith(path)) missed.push(`${path} (searched "${file.unique}", top: ${top?.path ?? "nothing"})`);
  }
  assert.deepEqual(missed, []);
});

test("the file and chunk counts are counted from what search can reach", async () => {
  const { runtime } = await loadAndIndex();
  const filesWithChunks = new Set(runtime.chunks.map((chunk) => chunk.path));
  assert.equal(runtime.summary.filesStored, 16);
  assert.equal(runtime.summary.filesIndexed, SEARCHABLE.length);
  assert.equal(runtime.summary.filesIndexed, filesWithChunks.size);
  assert.equal(runtime.summary.chunkCount, runtime.chunks.length);
  assert.equal(formatIndexSummary(runtime.summary), `Indexed 14 files, ${runtime.chunks.length} chunks.`);
});

test("every selected file is either indexed or named with a reason", async () => {
  const { load, runtime } = await loadAndIndex();
  assert.deepEqual(
    [...load.skippedFiles].sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: "assets/logo.png", reason: SKIP_LABEL.binaries },
      // A folder left out whole is one entry that counts its files.
      { path: "generated/", reason: SKIP_LABEL.vendor, count: 1 },
      { path: "notes.xyz", reason: SKIP_LABEL.types },
      { path: "src/empty.ts", reason: SKIP_LABEL.empty },
    ],
  );
  assert.deepEqual(runtime.summary.skipped, [
    { path: "acme-billing/.storybook/main.ts", reason: INDEX_SKIP.tooling },
    { path: "acme-billing/src/types/api.d.ts", reason: INDEX_SKIP.tooling },
  ]);
  // Nothing falls between the two lists.
  assert.equal(
    runtime.summary.filesIndexed + runtime.summary.skipped.length + skippedFileCount(load.skippedFiles),
    Object.keys(REPO).length,
  );
  assert.equal(load.selected, Object.keys(REPO).length);
});

test("a folder named like build output still indexes its files", async () => {
  for (const root of ["build", "out", "dist", "vendor"]) {
    const { runtime } = await loadAndIndex(root);
    assert.equal(runtime.summary.filesIndexed, SEARCHABLE.length, `folder named ${root}`);
    assert.equal(retrieve("ZEBRAFISH_TOLERANCE", runtime.chunks, 6)[0]?.path, `${root}/src/ledger/reconcile.ts`);
  }
});

test("a cached empty row written under the old rule is rebuilt", async () => {
  const { repo, context } = await loadAndIndex("build");
  const sources = (await repo.listSources(context.id)).filter(isTextSource);
  const target = sources.find((source) => source.path.endsWith("src/ledger/reconcile.ts"));
  const typings = sources.find((source) => source.path.endsWith("api.d.ts"));
  assert.ok(target && typings);
  for (const source of [target, typings]) {
    await repo.writeIndexed(
      {
        id: indexedSourceKey(context.id, source.id),
        contextId: context.id,
        sourceId: source.id,
        contentHash: source.contentHash,
        chunkerVersion: CHUNKER_VERSION,
        indexVersion: RETRIEVAL_INDEX_VERSION,
        indexedAt: Date.now(),
        chunkCount: 0,
      },
      [],
    );
  }
  const runtime = await indexContext(repo, context.id, { embed: false });
  assert.ok(runtime.chunks.some((chunk) => chunk.path === target.path));
  // A file that is not evidence keeps its empty row and is not rebuilt each time.
  assert.equal(runtime.chunks.some((chunk) => chunk.path === typings.path), false);
  assert.equal(runtime.report.rebuiltSourceCount, 1);
});

test("prunePack orders files and drops vendor folders, and nothing else", () => {
  const pack: RepoPack = {
    id: "p",
    name: "p",
    description: "",
    commits: [],
    files: [
      "docker-compose.yml",
      "config/limits.json",
      "e2e/checkout.spec.ts",
      "plugins/tax/includes/classes/rates/VatRates.php",
      "src/a.ts",
      "src/b.ts",
      "node_modules/x/index.js",
    ].map((path) => ({ path, language: "txt", content: "x" })),
  };
  const pruned = prunePack(pack);
  assert.equal(pruned.dropped, 1);
  assert.deepEqual(
    pruned.pack.files.map((file) => file.path).sort(),
    pack.files.map((file) => file.path).filter((path) => !path.startsWith("node_modules/")).sort(),
  );
  assert.equal(pruned.pack.files[0].path.startsWith("src/"), true);
  // Two source files beside config was not a "mostly CI/config" pack before
  // the config files were kept, and still is not.
  assert.equal(pruned.weak, false);
});

test("a file left out at any load step is listed with its reason", async () => {
  const files = [
    fileAt("src/a.ts", "export const a = 1\n", "repo"),
    fileAt("src/a.test.ts", "test('a', () => {})\n", "repo"),
    fileAt("yarn.lock", "lock\n", "repo"),
    fileAt("src/big.ts", "x".repeat(150_001), "repo"),
    fileAt("src/app.min.js", "var a=1\n", "repo"),
  ];
  const load = await packFromScan(scanFileList(files), { includeTests: false });
  assert.deepEqual(load.pack.files.map((file) => file.path), ["src/a.ts"]);
  assert.deepEqual(
    [...load.skippedFiles].sort((a, b) => a.path.localeCompare(b.path)),
    [
      { path: "src/a.test.ts", reason: SKIP_LABEL.tests },
      { path: "src/app.min.js", reason: SKIP_LABEL.generated },
      { path: "src/big.ts", reason: SKIP_LABEL.size },
      { path: "yarn.lock", reason: SKIP_LABEL.lockfiles },
    ],
  );
  assert.equal(load.skipped, load.skippedFiles.length);
});

test("a folder past the old 500-file limit loads whole", async () => {
  const files = Array.from({ length: 503 }, (_, i) => fileAt(`src/f${String(i).padStart(3, "0")}.ts`, `export const v${i} = ${i}\n`, "repo"));
  const load: FolderLoad = await packFromFiles(files);
  assert.equal(load.pack.files.length, 503);
  assert.equal(load.truncated, false);
  assert.deepEqual(load.skippedFiles, []);
});

test("files past the file limit are listed with the limit they ran into", async () => {
  const files = Array.from({ length: 503 }, (_, i) => fileAt(`src/f${String(i).padStart(3, "0")}.ts`, `export const v${i} = ${i}\n`, "repo"));
  const limits = { maxFiles: 500 };
  const load: FolderLoad = await packFromFiles(files, { limits });
  assert.equal(load.pack.files.length, 500);
  assert.equal(load.truncated, true);
  assert.deepEqual(
    load.skippedFiles,
    ["src/f500.ts", "src/f501.ts", "src/f502.ts"].map((path) => ({ path, reason: "over the 500-file limit" })),
  );
  assert.ok(load.skippedFiles.every((item) => isLimitReason(item.reason)));
});

test("a load stops reading at the file where it is cancelled", async () => {
  const files = Array.from({ length: 60 }, (_, i) => fileAt(`src/f${String(i).padStart(2, "0")}.ts`, `export const v${i} = ${i}\n`, "repo"));
  let opened = 0;
  for (const file of files) {
    const read = file.arrayBuffer.bind(file);
    Object.defineProperty(file, "arrayBuffer", {
      value: () => {
        opened += 1;
        return read();
      },
    });
  }
  const reported: number[] = [];
  const load = await packFromFiles(files, {
    onRead: (done) => reported.push(done),
    isCancelled: () => opened >= 10,
  });
  assert.equal(load.cancelled, true);
  // Ten files were opened before the question was asked again; no eleventh.
  assert.equal(opened, 10);
  assert.equal(load.pack.files.length, 10);
  // A cancelled load never reports itself finished.
  assert.equal(reported.includes(60), false);
});

test("a file that cannot be read is listed as failed", async () => {
  const broken = fileAt("src/broken.ts", "x", "repo");
  Object.defineProperty(broken, "arrayBuffer", { value: () => Promise.reject(new Error("gone")) });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const load = await packFromFiles([fileAt("src/a.ts", "export const a = 1\n", "repo"), broken]);
    assert.deepEqual(load.failed, ["broken.ts"]);
    assert.deepEqual(load.skippedFiles, [{ path: "src/broken.ts", reason: SKIP_LABEL.failed }]);
  } finally {
    console.warn = warn;
  }
});

test("a picked folder lists a vendor folder once, with how many files it held", async () => {
  const file = (name: string, content: string): FsEntry => ({
    kind: "file",
    name,
    getFile: async () => new File([content], name),
  });
  const dir = (name: string, entries: FsEntry[]): FsEntry & DirectoryLike => ({
    kind: "directory",
    name,
    values: async function* () {
      yield* entries;
    },
  });
  const root: DirectoryLike = dir("repo", [
    dir("src", [file("a.ts", "export const a = 1\n"), file("logo.png", "xx")]),
    dir("node_modules", [dir("left-pad", [file("index.js", "x"), file("package.json", "{}")]), file("x.js", "x")]),
  ]);
  const scan = await scanDirectoryHandle(root);
  assert.equal(scan.selected, 5);
  assert.deepEqual(scan.skippedFiles, [
    { path: "src/logo.png", reason: SKIP_LABEL.binaries },
    { path: "node_modules/", reason: SKIP_LABEL.vendor, count: 3 },
  ]);
  assert.equal(skippedFileCount(scan.skippedFiles ?? []), 4);
  const load = await packFromScan(scan);
  assert.equal(load.skipped, skippedFileCount(load.skippedFiles));
});

test("summarizeIndex gives the reason for an excluded file and an unreadable PDF", () => {
  const chunks = buildChunks({
    id: "p",
    name: "p",
    description: "",
    commits: [],
    files: [{ path: "src/a.ts", language: "ts", content: "export const a = 1\n" }],
  });
  const summary = summarizeIndex(
    [
      { kind: "file", path: "src/a.ts", content: "export const a = 1\n" },
      { kind: "file", path: "docs/private.md", content: "secret\n" },
      { kind: "pdf", path: "scan.pdf", sourceId: "pdf-1", readiness: "unreadable" },
      { kind: "pdf", path: "slow.pdf", sourceId: "pdf-2", readiness: "pending" },
    ],
    chunks,
    ["docs/*.md"],
  );
  assert.equal(summary.filesIndexed, 1);
  assert.equal(summary.chunking, "windows");
  assert.deepEqual(
    Object.fromEntries(summary.skipped.map((item) => [item.path, item.reason])),
    {
      "docs/private.md": INDEX_SKIP.excluded,
      "scan.pdf": "MeetHint couldn't read this PDF.",
      "slow.pdf": INDEX_SKIP.pending,
    },
  );
  assert.deepEqual(
    groupSkipped([...summary.skipped, { path: "node_modules/", reason: SKIP_LABEL.vendor, count: 40 }]).map(
      (group) => [group.reason, group.count],
    )[0],
    [SKIP_LABEL.vendor, 40],
  );
});

test("the built-in sample, which is never stored, is summarized from its pack", () => {
  const chunks = buildChunks(NORTHSTAR);
  const summary = summarizeLoaded([], NORTHSTAR, chunks);
  assert.equal(summary.filesIndexed, NORTHSTAR.files.length);
  assert.equal(summary.chunkCount, chunks.length);
  assert.deepEqual(summary.skipped, []);
});

test("repos are chunked with line windows; the summary says so when symbols are on", () => {
  const pack: RepoPack = {
    id: "p",
    name: "p",
    description: "",
    commits: [],
    files: [{ path: "src/a.ts", language: "ts", content: "export function alpha() {\n  return 1;\n}\n" }],
  };
  const source = [{ kind: "file" as const, path: "src/a.ts", content: pack.files[0].content }];
  assert.equal(summarizeIndex(source, buildChunks(pack)).chunking, "windows");
  assert.equal(summarizeIndex(source, buildChunks(pack, { structured: true })).chunking, "structured");
});

test("the index line is printed and kept only when the debug flag is on", async () => {
  const { load, runtime } = await loadAndIndex();
  const lines: string[] = [];
  const info = console.info;
  console.info = (...args: unknown[]) => {
    lines.push(args.join(" "));
  };
  try {
    assert.equal(reportIndexSummary("acme-billing", runtime.summary, load.skippedFiles), null);
    assert.equal(lines.length, 0);
    process.env.DEBUG_SEARCH = "true";
    const record = reportIndexSummary("acme-billing", runtime.summary, load.skippedFiles);
    assert.equal(record?.summary.filesIndexed, 14);
  } finally {
    console.info = info;
  }
  assert.match(lines[0], /^\[index\] acme-billing: Indexed 14 files, 14 chunks\. 16 stored, 6 not indexed\. Chunking: 28-line windows\.$/);
  assert.ok(lines.some((line) => line.includes(`2 × ${INDEX_SKIP.tooling}: acme-billing/.storybook/main.ts, acme-billing/src/types/api.d.ts`)));
  assert.ok(lines.some((line) => line.includes(`1 × ${SKIP_LABEL.empty}: src/empty.ts`)));
  assert.equal((globalThis as { __meethintIndexDebug?: IndexDebugRecord[] }).__meethintIndexDebug?.length, 1);
});
