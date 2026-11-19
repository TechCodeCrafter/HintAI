import assert from "node:assert/strict";
import { test } from "node:test";
import { indexContext } from "../../context/chunk-index.ts";
import { createMemoryRepository } from "../../context/memory.ts";
import { persistPackAsContext } from "../../context/service.ts";
import { readDrop, type DropEntry } from "../drop-entries.ts";
import { packFromFiles, scanFileList, SKIP_LABEL } from "../folder.ts";

function fileEntry(fullPath: string, content = "x"): DropEntry {
  const name = fullPath.split("/").pop()!;
  return {
    isFile: true,
    isDirectory: false,
    name,
    fullPath,
    file: (ok) => ok(new File([content], name)),
  };
}

/** Hands entries back two at a time, the way browsers batch readEntries. */
function dirEntry(fullPath: string, children: DropEntry[]): DropEntry {
  return {
    isFile: false,
    isDirectory: true,
    name: fullPath.split("/").pop()!,
    fullPath,
    createReader: () => {
      let at = 0;
      return {
        readEntries: (ok) => {
          const batch = children.slice(at, at + 2);
          at += 2;
          ok(batch);
        },
      };
    },
  };
}

function itemOf(entry: DropEntry) {
  return { kind: "file", webkitGetAsEntry: () => entry };
}

const relative = (file: File) => (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? "";

test("a dropped folder is walked and its files keep their paths", async () => {
  const folder = dirEntry("/nerd", [
    fileEntry("/nerd/README.md", "# Nerd\n"),
    dirEntry("/nerd/src", [
      fileEntry("/nerd/src/a.ts", "export const A = 1;\n"),
      fileEntry("/nerd/src/b.ts", "export const B = 2;\n"),
      fileEntry("/nerd/src/c.ts", "export const C = 3;\n"),
    ]),
    dirEntry("/nerd/node_modules", [fileEntry("/nerd/node_modules/x/index.js")]),
  ]);
  const dropped = await readDrop({ items: [itemOf(folder)], files: [new File([], "nerd")] });
  assert.equal(dropped.folder, true);
  assert.deepEqual(dropped.files.map(relative).sort(), [
    "nerd/README.md",
    "nerd/src/a.ts",
    "nerd/src/b.ts",
    "nerd/src/c.ts",
  ]);
  // The folder reader sees a normal folder selection, not one unreadable entry.
  const scan = scanFileList(dropped.files);
  assert.equal(scan.folderName, "nerd");
  assert.deepEqual(scan.candidates.map((item) => item.path).sort(), ["README.md", "src/a.ts", "src/b.ts", "src/c.ts"]);
});

test("dropped loose files are passed through as files", async () => {
  const dropped = await readDrop({ items: [itemOf(fileEntry("/notes.md")), itemOf(fileEntry("/plan.txt"))] });
  assert.equal(dropped.folder, false);
  assert.deepEqual(dropped.files.map((file) => file.name), ["notes.md", "plan.txt"]);
  assert.deepEqual(dropped.files.map(relative), ["", ""]);
});

test("a browser without the entry API falls back to the file list", async () => {
  const files = [new File(["a"], "a.md")];
  const dropped = await readDrop({ items: [{ kind: "file" }], files });
  assert.equal(dropped.folder, false);
  assert.deepEqual(dropped.files, files);
});

test("a folder that cannot be listed yields no files rather than throwing", async () => {
  const broken: DropEntry = {
    isFile: false,
    isDirectory: true,
    name: "locked",
    fullPath: "/locked",
    createReader: () => ({ readEntries: (_ok, fail) => fail?.(new Error("denied")) }),
  };
  const dropped = await readDrop({ items: [itemOf(broken)] });
  assert.equal(dropped.folder, true);
  assert.deepEqual(dropped.files, []);
  assert.deepEqual(dropped.skipLabels, [SKIP_LABEL.failed]);
});

test("nested build output cannot consume the walk cap, even in a root named build", async () => {
  let buildReads = 0;
  const generated = dirEntry("/build/site/BUILD", Array.from({ length: 20_000 }, (_, i) =>
    fileEntry(`/build/site/BUILD/${i}.js`, "generated")));
  assert.ok(generated.isDirectory);
  const open = generated.createReader;
  generated.createReader = () => {
    buildReads += 1;
    return open();
  };
  const dropped = await readDrop({ items: [itemOf(dirEntry("/build", [
    dirEntry("/build/site", [generated]),
    fileEntry("/build/main.ts", "export const Main = 1"),
  ]))] });
  assert.equal(buildReads, 0);
  assert.equal(dropped.capped, false);
  assert.deepEqual(dropped.skipLabels, [SKIP_LABEL.vendor]);
  assert.deepEqual(scanFileList(dropped.files).candidates.map(({ path }) => path), ["main.ts"]);
});

test("a directory with more than the walk limit reports that the listing is incomplete", async () => {
  const entries = Array.from({ length: 20_001 }, (_, i) => fileEntry(`/notes/${i}.txt`));
  const dropped = await readDrop({ items: [itemOf(dirEntry("/notes", entries))] });
  assert.equal(dropped.files.length, 20_000);
  assert.equal(dropped.capped, true);
});

test("multiple roots and loose files keep distinct paths through persistence", async () => {
  const dropped = await readDrop({ items: [
    itemOf(dirEntry("/build", [fileEntry("/build/main.ts", "export const Build = 1")])),
    itemOf(dirEntry("/project", [fileEntry("/project/main.ts", "export const Project = 1")])),
    itemOf(fileEntry("/main.ts", "export const Loose = 1")),
  ] });
  const { pack } = await packFromFiles(dropped.files);
  const paths = ["build/main.ts", "project/main.ts", "main.ts"];
  assert.deepEqual(new Set(pack.files.map(({ path }) => path)), new Set(paths));
  const repo = createMemoryRepository();
  const saved = await persistPackAsContext(pack, repo);
  assert.equal(saved.pack.files.length, paths.length);
  const indexed = await indexContext(repo, saved.context.id, { embed: false });
  assert.equal(indexed.pack.files.length, paths.length);
});

test("unprefixed entry methods are preferred and a throwing getter can fall back", async () => {
  const folder = dirEntry("/docs", [fileEntry("/docs/notes.md")]);
  const loose = fileEntry("/intro.md");
  const dropped = await readDrop({ items: [
    { kind: "file", getAsEntry: () => folder, webkitGetAsEntry: () => null },
    { kind: "file", getAsEntry: () => { throw new Error("Unavailable"); }, webkitGetAsEntry: () => loose },
  ] });
  assert.equal(dropped.folder, true);
  assert.deepEqual(dropped.files.map((file) => file.name), ["notes.md", "intro.md"]);
});

test("sync errors in an entry do not reject the drop or hide sibling files", async () => {
  const lockedDir = dirEntry("/notes/locked-dir", []);
  const lockedFile = fileEntry("/notes/locked.txt");
  assert.ok(lockedDir.isDirectory && lockedFile.isFile);
  lockedDir.createReader = () => { throw new Error("Permission denied"); };
  lockedFile.file = () => { throw new Error("Removed"); };
  const dropped = await readDrop({ items: [itemOf(dirEntry("/notes", [
    lockedDir, lockedFile, fileEntry("/notes/readable.txt"),
  ]))] });
  assert.deepEqual(dropped.files.map((file) => file.name), ["readable.txt"]);
  assert.deepEqual(dropped.skipLabels, [SKIP_LABEL.failed]);
});
