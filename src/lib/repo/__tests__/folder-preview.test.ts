import assert from "node:assert/strict";
import { test } from "node:test";

import {
  packFromFiles,
  previewFolder,
  scanDirectoryHandle,
  SKIP_LABEL,
  type DirectoryLike,
  type FsEntry,
} from "../folder.ts";

function fileAt(path: string, content: string): File {
  const name = path.split("/").pop() ?? path;
  const file = new File([content], name, { type: "text/plain" });
  Object.defineProperty(file, "webkitRelativePath", { value: `repo/${path}`, configurable: true });
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
