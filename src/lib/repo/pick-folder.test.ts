import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { pickFolderScan } from "./pick-folder.ts";

const g = globalThis as unknown as { window?: unknown };
afterEach(() => {
  delete g.window;
});

function withPicker(picker: unknown) {
  g.window = { showDirectoryPicker: picker };
}

test("a closed folder dialog is a cancel, not a failure", async () => {
  withPicker(async () => {
    throw new DOMException("closed", "AbortError");
  });
  assert.deepEqual(await pickFolderScan(), { status: "cancelled" });
});

test("a refused folder picker asks the caller to fall back", async () => {
  withPicker(async () => {
    throw new DOMException("cross-origin frame", "SecurityError");
  });
  assert.deepEqual(await pickFolderScan(), { status: "unavailable" });
});

test("no folder picker at all asks the caller to fall back", async () => {
  g.window = {};
  assert.deepEqual(await pickFolderScan(), { status: "unavailable" });
});

test("a picked folder is scanned", async () => {
  const file = new File(["export const A = 1;\n"], "a.ts");
  const dir = {
    kind: "directory",
    name: "proj",
    async *values() {
      yield { kind: "file", name: "a.ts", getFile: async () => file };
    },
  };
  withPicker(async () => dir);
  const result = await pickFolderScan();
  assert.equal(result.status, "picked");
  if (result.status === "picked") assert.equal(result.scan.selected, 1);
});
