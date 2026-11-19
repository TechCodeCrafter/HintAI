import assert from "node:assert/strict";
import { test } from "node:test";
import { readDrop, type DropEntry } from "../drop-entries.ts";
import { packFromFiles, previewScan, scanFileList, SKIP_LABEL } from "../folder.ts";

function fileEntry(fullPath: string, content: string, type: string): DropEntry {
  const name = fullPath.split("/").at(-1)!;
  return {
    isFile: true,
    isDirectory: false,
    fullPath,
    name,
    file: (ok) => queueMicrotask(() => ok(new File([content], name, { type }))),
  };
}

function directory(fullPath: string, children: DropEntry[]): DropEntry {
  return {
    isFile: false,
    isDirectory: true,
    fullPath,
    name: fullPath.split("/").at(-1)!,
    createReader: () => {
      let offset = 0;
      return {
        readEntries: (ok) => queueMicrotask(() => ok(children.slice(offset, ++offset))),
      };
    },
  };
}

test("mixed folder drop keeps paths, counts PDFs separately and skips binaries and build output", async () => {
  const root = directory("/materials", [
    directory("/materials/src", [fileEntry("/materials/src/retry.ts", "export const retries = 3;\n", "text/plain")]),
    fileEntry("/materials/guide.PDF", "%PDF-1.4\n", "application/pdf"),
    fileEntry("/materials/diagram.png", "image fixture", "image/png"),
    directory("/materials/site", [
      directory("/materials/site/build", [fileEntry("/materials/site/build/generated.js", "var generated = 1;", "text/javascript")]),
    ]),
  ]);
  const drop = await readDrop({
    items: [{ kind: "file", webkitGetAsEntry: () => root }],
    files: [new File([], root.name)],
  });
  assert.equal(drop.folder, true);
  assert.equal(drop.files.length, 3);
  assert.deepEqual(drop.skipLabels, [SKIP_LABEL.vendor]);

  const scan = scanFileList(drop.files, { skipLabels: drop.skipLabels });
  const preview = previewScan(scan, { includeTests: false });
  assert.equal(preview.folderName, "materials");
  assert.equal(preview.selected, 3);
  assert.equal(preview.keep, 1);
  assert.equal(preview.pdfs, 1);
  assert.equal(preview.skipped, 1);
  assert.equal(preview.keep + preview.pdfs + preview.skipped, preview.selected);
  assert.deepEqual(new Set(preview.skipLabels), new Set([SKIP_LABEL.binaries, SKIP_LABEL.vendor]));
  assert.deepEqual(preview.keepSample, ["src/retry.ts"]);
  assert.deepEqual(scan.pdfs.map((file) => file.webkitRelativePath), ["materials/guide.PDF"]);

  const pack = await packFromFiles(drop.files, { includeTests: false, skipLabels: drop.skipLabels });
  assert.equal(pack.selected, preview.selected);
  assert.equal(pack.skipped, preview.skipped);
  assert.equal(pack.truncated, preview.truncated);
  assert.deepEqual(new Set(pack.skipLabels), new Set(preview.skipLabels));
  assert.deepEqual(pack.pack.files.map((file) => file.path), preview.keepSample);

  // The UI hands only non-PDF candidates to the folder pack reader.
  const confirmed = await packFromFiles(scan.candidates.map(({ file }) => file), {
    includeTests: false,
    selectedCount: scan.selected - scan.pdfs.length,
    skipLabels: scan.skipLabels,
  });
  assert.equal(confirmed.selected + preview.pdfs, preview.selected);
  assert.equal(confirmed.skipped, preview.skipped);
  assert.deepEqual(confirmed.skipLabels, preview.skipLabels);
  assert.deepEqual(confirmed.pack.files, pack.pack.files);
});
