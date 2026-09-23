import assert from "node:assert/strict";
import test from "node:test";
import { isPdfFile, splitMaterialFiles } from "../material-upload.ts";

test("splitMaterialFiles separates PDFs from other uploads", () => {
  const pdfs = [new File(["a"], "guide.pdf", { type: "application/pdf" })];
  const other = [new File(["b"], "readme.md", { type: "text/markdown" })];
  const split = splitMaterialFiles([...other, ...pdfs]);
  assert.equal(split.pdfs.length, 1);
  assert.equal(split.other.length, 1);
  assert.equal(split.pdfs[0]?.name, "guide.pdf");
  assert.equal(split.other[0]?.name, "readme.md");
});

test("isPdfFile accepts extension-only PDF names", () => {
  assert.equal(isPdfFile(new File(["a"], "scan.PDF", { type: "" })), true);
});
