import assert from "node:assert/strict";
import { test } from "node:test";

import { setFolderLimitsForTests } from "../limits.ts";
import {
  emptySelectionMessage,
  packFromFiles,
  packFromScan,
  previewFolder,
  previewScan,
  scanDirectoryHandle,
  scanFileList,
  SKIP_LABEL,
  type DirectoryLike,
  type FsEntry,
} from "../folder.ts";

function fileAt(path: string, content: string, root = "repo"): File {
  const name = path.split("/").pop() ?? path;
  const file = new File([content], name, { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", { value: `${root}/${path}`, configurable: true });
  return file;
}

test("previewFolder counts keep vs skip without reading contents", () => {
  const preview = previewFolder(
    [
      fileAt("src/retry.ts", "export const n = 3"),
      fileAt("node_modules/x/index.js", "module.exports = 1"),
      fileAt("src/retry.test.ts", "test('x', () => {})"),
      fileAt("photo.png", "xx"),
    ],
    { includeTests: false },
  );
  assert.equal(preview.keep, 1);
  assert.equal(preview.skipped, 3);
  assert.equal(preview.folderName, "repo");
  assert.ok(preview.skipLabels.includes(SKIP_LABEL.vendor));
  assert.ok(preview.skipLabels.includes(SKIP_LABEL.binaries));
  assert.ok(preview.skipLabels.includes(SKIP_LABEL.tests));
  assert.deepEqual(preview.keepSample, ["src/retry.ts"]);
});

test("previewFolder skips Word lock files", () => {
  const preview = previewFolder(
    [
      fileAt("docs/Novare_Labs_AI_User_Guide.docx", "PK"),
      fileAt("docs/~$ovare_Labs_AI_User_Guide.docx", "lock"),
      fileAt("src/client.py", "class APIClient:\n    pass\n"),
    ],
    { includeTests: true },
  );
  assert.equal(preview.keep, 2);
  assert.deepEqual(preview.keepSample, ["src/client.py", "docs/Novare_Labs_AI_User_Guide.docx"]);
  assert.ok(preview.skipLabels.includes(SKIP_LABEL.lockfiles));
});

test("packFromFiles does not treat Word lock files as read failures", async () => {
  const loaded = await packFromFiles(
    [
      fileAt("docs/~$ovare_Labs_AI_User_Guide.docx", "lock"),
      fileAt("src/client.py", "class APIClient:\n    pass\n"),
    ],
    { includeTests: true },
  );
  assert.deepEqual(
    loaded.pack.files.map((file) => file.path),
    ["src/client.py"],
  );
  assert.deepEqual(loaded.failed, []);
});

test("includeTests keeps spec files in the preview", () => {
  const preview = previewFolder(
    [fileAt("src/retry.ts", "export const n = 3"), fileAt("src/retry.test.ts", "test('x', () => {})")],
    { includeTests: true },
  );
  assert.equal(preview.keep, 2);
  assert.equal(preview.skipLabels.includes(SKIP_LABEL.tests), false);
});

test("packFromFiles honors includeTests: false", async () => {
  const loaded = await packFromFiles(
    [fileAt("src/retry.ts", "export const RETRIES = 3\n"), fileAt("src/retry.test.ts", "test('retry', () => {})\n")],
    { includeTests: false },
  );
  assert.deepEqual(
    loaded.pack.files.map((file) => file.path),
    ["src/retry.ts"],
  );
  assert.equal(loaded.skipped, 1);
});

test("scanDirectoryHandle skips vendor trees without reading them", async () => {
  let vendorReads = 0;
  const handle: DirectoryLike = {
    name: "payments",
    async *values() {
      yield {
        kind: "directory",
        name: "src",
        async *values() {
          yield fileEntry("retry.ts", "export const RETRIES = 3\n");
        },
      } satisfies FsEntry;
      yield {
        kind: "directory",
        name: "node_modules",
        async *values() {
          yield {
            kind: "file",
            name: "index.js",
            getFile: async () => {
              vendorReads += 1;
              return new File(["nope"], "index.js");
            },
          };
        },
      } satisfies FsEntry;
    },
  };
  const scan = await scanDirectoryHandle(handle);
  assert.equal(scan.folderName, "payments");
  assert.equal(scan.selected, 2);
  assert.equal(scan.candidates.length, 1);
  assert.equal(scan.candidates[0]?.path, "src/retry.ts");
  assert.equal(vendorReads, 0);
  assert.ok(scan.skipLabels.includes(SKIP_LABEL.vendor));
});

function fileEntry(name: string, content: string): FsEntry {
  return {
    kind: "file",
    name,
    getFile: async () => new File([content], name, { type: "text/plain" }),
  };
}

test("read failures explain why metadata-eligible files did not index", async () => {
  const files = [
    fileAt("empty.MD", " \n"),
    fileAt("binary.txt", "binary\0data"),
    fileAt("broken.DOCX", "not a Word document"),
  ];
  const preview = previewFolder(files);
  const loaded = await packFromFiles(files);
  assert.equal(preview.keep, 3);
  assert.equal(loaded.pack.files.length, 0);
  assert.equal(loaded.skipped, 3);
  assert.deepEqual(loaded.failed, ["broken.DOCX"]);
  assert.match(emptySelectionMessage(loaded), /All 3 selected files.* non-text files.* no readable text.* could not be opened/i);
});

test("review samples and limits count the same readable files as the pack", async () => {
  const files = [
    ...Array.from({ length: 500 }, (_, i) => fileAt(`src/blank-${i}.ts`, "")),
    fileAt("z-notes.txt", "Real material"),
  ];
  const scan = scanFileList(files);
  const preview = previewScan(scan);
  const loaded = await packFromScan(scan);
  assert.deepEqual(preview.keepSample, loaded.pack.files.map((item) => item.path));
  assert.equal(preview.truncated, false);
  assert.equal(preview.keep, 1);
});

test("folder PDFs are identified separately from images, archives and dependency PDFs", async () => {
  const files = [fileAt("guide.PDF", "%PDF minimal"), fileAt("photo.png", "image"), fileAt("node_modules/readme.pdf", "not selected")];
  const scan = scanFileList(files);
  const preview = previewScan(scan);
  const loaded = await packFromFiles(files);
  assert.equal(preview.keep, 0);
  assert.equal(preview.pdfs, 1);
  assert.equal(preview.selected, 3);
  assert.equal(preview.skipped, 2);
  assert.deepEqual(scan.pdfs.map((file) => file.name), ["guide.PDF"]);
  assert.deepEqual(preview.skipLabels, [SKIP_LABEL.binaries, SKIP_LABEL.vendor]);
  assert.deepEqual(loaded.skipLabels, preview.skipLabels);
  assert.equal(loaded.skipped, preview.skipped);
});

test("directory handles send both uppercase and MIME-identified PDFs to the PDF route", async () => {
  const scan = await scanDirectoryHandle({
    name: "notes",
    async *values() {
      yield fileEntry("guide.PDF", "%PDF minimal");
      yield {
        kind: "file",
        name: "paper",
        getFile: async () => new File(["%PDF minimal"], "paper", { type: "application/pdf" }),
      };
    },
  });
  const preview = previewScan(scan);
  assert.equal(preview.pdfs, 2);
  assert.equal(preview.skipped, 0);
  assert.deepEqual(scan.pdfs.map((file) => file.webkitRelativePath), ["notes/guide.PDF", "notes/paper"]);
});

test("directory-handle failure identifies one bad entry without hiding its siblings", async () => {
  const scan = await scanDirectoryHandle({
    name: "notes",
    async *values() {
      yield { kind: "file", name: "removed.txt", getFile: async () => { throw new Error("File disappeared"); } };
      yield fileEntry("remaining.TXT", "Still available");
    },
  });
  const preview = previewScan(scan);
  assert.equal(preview.selected, 2);
  assert.deepEqual(preview.keepSample, ["remaining.TXT"]);
  assert.match(preview.skipLabels.join(" "), /could not read/);
});

test("manually chosen JSON is not subject to the project's small JSON filter", async () => {
  const content = JSON.stringify({ notes: "x".repeat(13_000) });
  const loaded = await packFromFiles([new File([content], "export.JSON")]);
  assert.equal(loaded.pack.files[0]?.content, content);
  const preview = previewFolder([fileAt("export.JSON", content)]);
  assert.equal(preview.keep, 0);
  assert.deepEqual(preview.skipLabels, [SKIP_LABEL.json]);
});

test("common extensionless names and text formats are kept regardless of chosen folder name", async () => {
  const paths = [
    "README", "LICENSE", "Dockerfile", "Makefile", "index.HTML", "style.CSS",
    "migration.SQL", "config.TOML", "setup.SH", "guide.RST", "lab.IPYNB",
  ];
  for (const root of ["build", "dist", "test", "docs", "out", ".notes"]) {
    const files = [
      ...paths.map((path) => fileAt(path, "Project material", root)),
      fileAt("build/compiled.js", "generated", root),
      fileAt("node_modules/package/index.js", "dependency", root),
    ];
    const loaded = await packFromFiles(files, { includeTests: false });
    assert.equal(loaded.pack.name, root);
    assert.deepEqual(new Set(loaded.pack.files.map((file) => file.path)), new Set(paths));
  }
  const scan = await scanDirectoryHandle({
    name: "dist",
    async *values() {
      for (const path of paths) yield fileEntry(path, "Project material");
    },
  });
  assert.deepEqual(new Set((await packFromScan(scan)).pack.files.map((file) => file.path)), new Set(paths));
});

test("BOM-marked UTF-16 text and CSV are readable, while binary bytes in a CSV are rejected", async () => {
  const bomText = (text: string) => Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, "utf16le")]);
  const loaded = await packFromFiles([
    new File([new Uint8Array(bomText("Meeting notes"))], "notes.txt"),
    new File([new Uint8Array(bomText("Name,Role\nAlice,Engineer"))], "table.csv"),
    new File([new Uint8Array([0, 1, 2, 3, 4, 5])], "binary.csv"),
  ]);
  assert.deepEqual(loaded.pack.files.map((file) => [file.path, file.content]), [
    ["table.csv", "Name | Role\nAlice | Engineer"],
    ["notes.txt", "Meeting notes"],
  ]);
});

test("invalid XLSX files are reported as unreadable, not indexed as CSV text", async () => {
  const loaded = await packFromFiles([new File(["not a spreadsheet"], "broken.xlsx")]);
  assert.equal(loaded.pack.files.length, 0);
  assert.deepEqual(loaded.failed, ["broken.xlsx"]);
});

const LOW_LIMITS = { maxFiles: 500, maxTotalBytes: 8 * 1024 * 1024 };

test("review agrees with the pack at both count and byte limits", async () => {
  setFolderLimitsForTests(LOW_LIMITS);
  try {
    for (const [files, expectedReason] of [
      [Array.from({ length: 501 }, (_, i) => fileAt(`src/notes-${i}.txt`, "notes")), "over the 500-file limit"],
      [
        Array.from({ length: 60 }, (_, i) => fileAt(`src/notes-${i}.txt`, "x".repeat(150_000))),
        "over the 8 MB total size limit",
      ],
    ] as const) {
      assert.ok([SKIP_LABEL.cap, SKIP_LABEL.total].includes(expectedReason));
      const scan = scanFileList(files);
      const preview = previewScan(scan);
      const loaded = await packFromScan(scan);
      assert.equal(preview.keep, loaded.pack.files.length);
      assert.equal(preview.skipped, loaded.skipped);
      assert.deepEqual(preview.skipLabels, [expectedReason]);
      assert.deepEqual(loaded.skipLabels, preview.skipLabels);
      assert.equal(preview.overLimit, loaded.skippedFiles.length);
      assert.ok(preview.overLimit > 0);
      assert.deepEqual(preview.limits, LOW_LIMITS);
    }
  } finally {
    setFolderLimitsForTests(null);
  }
});

test("the same selections load whole under the default limits", async () => {
  for (const files of [
    Array.from({ length: 501 }, (_, i) => fileAt(`src/notes-${i}.txt`, "notes")),
    Array.from({ length: 55 }, (_, i) => fileAt(`src/notes-${i}.txt`, "x".repeat(150_000))),
  ]) {
    const scan = scanFileList(files);
    const preview = previewScan(scan);
    const loaded = await packFromScan(scan);
    assert.equal(preview.keep, files.length);
    assert.equal(preview.truncated, false);
    assert.equal(preview.overLimit, 0);
    assert.equal(loaded.pack.files.length, files.length);
    assert.deepEqual(loaded.skippedFiles, []);
  }
});

test("size, binary media and test-only selections have specific next steps", async () => {
  const tooLarge = await packFromFiles([fileAt("notes.txt", "x".repeat(150_001))]);
  assert.match(emptySelectionMessage(tooLarge), /too large.*Choose smaller files/);
  const media = await packFromFiles([fileAt("photo.png", "image"), fileAt("archive.zip", "archive")]);
  const formats = "Choose code, Markdown, text, PDF, Word, Excel, or PowerPoint files.";
  assert.equal(
    emptySelectionMessage(media),
    `All 2 selected files were images, archives, or other non-text files. ${formats}`,
  );
  assert.equal(emptySelectionMessage(await packFromFiles([])), `No files were selected. ${formats}`);
  const tests = await packFromFiles([fileAt("source.spec.ts", "test material")], { includeTests: false });
  assert.match(emptySelectionMessage(tests), /Turn on Include tests/);
});

test("confirmed candidates preserve mixed skip reasons from before the read", async () => {
  const scan = scanFileList([
    fileAt("broken.docx", "not a Word document"),
    fileAt("photo.png", "image"),
    fileAt("build/out.js", "generated"),
  ]);
  const loaded = await packFromFiles(scan.candidates.map(({ file }) => file), {
    selectedCount: scan.selected,
    skipLabels: scan.skipLabels,
  });
  assert.deepEqual(loaded.skipLabels, [SKIP_LABEL.binaries, SKIP_LABEL.vendor, SKIP_LABEL.failed]);
  const message = emptySelectionMessage(loaded);
  assert.match(message, /3 selected files.*build or dependency folders.*images.*could not be opened/);
  assert.match(message, /broken\.docx/);
});
