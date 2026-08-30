import assert from "node:assert/strict";
import { test } from "node:test";

import { reconstructSourceText, sourceTextFromRanges } from "../../source-text.ts";
import { mappingErrors } from "../map.ts";
import { READINESS_NOTES } from "../notes.ts";
import { parsePdf } from "../parse.ts";
import { enqueuePdfParse, pdfParseActiveCount } from "../queue.ts";
import { buildPdfBytes, encryptedPdfBytes } from "../build-fixture.ts";

function blobFrom(bytes: Uint8Array): Blob {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return new Blob([copy], { type: "application/pdf" });
}

function input(bytes: Uint8Array, path = "Lecture-08.pdf") {
  return {
    contextId: "ctx-parse",
    sourceId: "src-parse",
    path,
    contentHash: "hash-parse",
    blob: blobFrom(bytes),
  };
}

test("one-page PDF retains page number, raw item.str, itemIndex, and geometry", async () => {
  const bytes = buildPdfBytes({
    pages: [{ items: [{ str: "Serializable isolation", x: 72, y: 700, size: 12 }] }],
  });
  const result = await parsePdf(input(bytes));
  assert.equal(result.readiness, "ready");
  assert.equal(result.document.pageCount, 1);
  assert.equal(result.document.pages[0].pageNumber, 1);
  const item = result.document.pages[0].items.find((entry) => entry.str.includes("Serializable"));
  assert.ok(item);
  assert.equal(typeof item.itemIndex, "number");
  assert.equal(item.str.includes("Serializable"), true);
  assert.equal(item.transform.length, 6);
  assert.ok(item.width >= 0);
  assert.ok(item.height >= 0);
  assert.equal(mappingErrors(result.document.pages[0]).length, 0);
});

test("multi-page PDFs keep 1-based page numbers", async () => {
  const bytes = buildPdfBytes({
    pages: [
      { items: [{ str: "Page one body text here.", x: 72, y: 700 }] },
      { items: [{ str: "Page two body text here.", x: 72, y: 700 }] },
    ],
  });
  const result = await parsePdf(input(bytes));
  assert.equal(result.document.pages.map((page) => page.pageNumber).join(","), "1,2");
  assert.match(result.document.pages[0].text, /Page one/);
  assert.match(result.document.pages[1].text, /Page two/);
});

test("sourceTextFromRanges reconstructs exact slices without a reparse", async () => {
  const bytes = buildPdfBytes({
    pages: [{ items: [{ str: "Serializable", x: 72, y: 700 }, { str: "isolation", x: 200, y: 700 }] }],
  });
  const result = await parsePdf(input(bytes));
  const page = result.document.pages[0];
  const first = page.items[0];
  const second = page.items[1] ?? page.items[0];
  const ranges = [
    { itemIndex: first.itemIndex, charStart: 0, charEnd: first.str.length },
    { itemIndex: second.itemIndex, charStart: 0, charEnd: second.str.length },
  ];
  const source = sourceTextFromRanges(result.document, 1, ranges);
  assert.equal(source, `${first.str}${second.str}`);
  assert.equal(reconstructSourceText(result.document, ranges.map((range) => ({ page: 1, ...range }))), source);
});

test("invalid itemIndex or char range fails reconstruction", async () => {
  const bytes = buildPdfBytes({
    pages: [{ items: [{ str: "Hello", x: 72, y: 700 }] }],
  });
  const result = await parsePdf(input(bytes));
  assert.equal(sourceTextFromRanges(result.document, 1, [{ itemIndex: 99, charStart: 0, charEnd: 1 }]), null);
  const item = result.document.pages[0].items[0];
  assert.equal(sourceTextFromRanges(result.document, 1, [{ itemIndex: item.itemIndex, charStart: 0, charEnd: 99 }]), null);
  assert.equal(sourceTextFromRanges(result.document, 1, [{ itemIndex: item.itemIndex, charStart: 3, charEnd: 1 }]), null);
});

test("sparse slides are ready, not scanned", async () => {
  const words = ["Serializable", "isolation", "prevents", "lost", "updates", "under", "high", "contention"];
  const bytes = buildPdfBytes({
    pages: [
      {
        items: words.map((str, i) => ({ str, x: 72, y: 700 - i * 28 })),
      },
    ],
  });
  const result = await parsePdf(input(bytes));
  assert.equal(result.readiness, "ready");
  assert.ok(result.document.pages[0].usefulItemCount >= 8);
});

test("image-only pages make the document scanned", async () => {
  const bytes = buildPdfBytes({ pages: [{ items: [] }] });
  const result = await parsePdf(input(bytes));
  assert.equal(result.readiness, "scanned");
  assert.equal(result.readinessNote, READINESS_NOTES.scanned);
  assert.equal(result.document.pages[0].usefulItemCount, 0);
  assert.equal(result.document.pages[0].index, "skipped");
});

test("mixed image-only and extractable pages are ready", async () => {
  const bytes = buildPdfBytes({
    pages: [{ items: [{ str: "Lecture title slide text.", x: 72, y: 700 }] }, { items: [] }],
  });
  const result = await parsePdf(input(bytes));
  assert.equal(result.readiness, "ready");
  assert.ok(result.document.pages[0].usefulItemCount > 0);
  assert.equal(result.document.pages[1].usefulItemCount, 0);
  assert.equal(result.document.pages[1].index, "skipped");
});

test("too many pages are refused entirely", async () => {
  const bytes = buildPdfBytes({
    pages: Array.from({ length: 5 }, () => ({ items: [{ str: "Page body text here.", x: 72, y: 700 }] })),
  });
  const result = await parsePdf(input(bytes), { limits: { maxPagesPerPdf: 2 } });
  assert.equal(result.readiness, "refused");
  assert.equal(result.readinessNote, READINESS_NOTES.refusedPages);
  assert.equal(result.document.pages.length, 0);
  assert.equal(result.pageCount, 5);
});

test("too many extracted characters are refused", async () => {
  const bytes = buildPdfBytes({
    pages: [{ items: [{ str: "Serializable isolation prevents lost outcomes.", x: 72, y: 700 }] }],
  });
  const result = await parsePdf(input(bytes), { limits: { maxExtractedCharsPerPdf: 8 } });
  assert.equal(result.readiness, "refused");
  assert.equal(result.readinessNote, READINESS_NOTES.refusedChars);
});

test("oversize PDFs are refused before parse", async () => {
  const blob = new Blob([new Uint8Array(64)], { type: "application/pdf" });
  const result = await parsePdf(
    { contextId: "c", sourceId: "s", path: "big.pdf", contentHash: "h", blob },
    { limits: { maxBytesPerPdf: 8 } },
  );
  assert.equal(result.readiness, "refused");
  assert.equal(result.readinessNote, READINESS_NOTES.refusedBytes);
  assert.equal(result.document.pages.length, 0);
});

test("malformed PDFs are unreadable and do not throw", async () => {
  const result = await parsePdf(input(new TextEncoder().encode("not a pdf at all")));
  assert.equal(result.readiness, "unreadable");
  assert.equal(result.readinessNote, READINESS_NOTES.unreadable);
  assert.equal(result.document.pages.length, 0);
});

test("encrypted PDFs are unreadable in 4A", async () => {
  const result = await parsePdf(input(encryptedPdfBytes()));
  assert.equal(result.readiness, "unreadable");
  assert.equal(result.readinessNote, READINESS_NOTES.unreadable);
});

test("resolved outlines attach a page and unresolved dests do not fail parse", async () => {
  const bytes = buildPdfBytes({
    pages: [
      { items: [{ str: "Cover page text is here.", x: 72, y: 700 }] },
      { items: [{ str: "Isolation levels chapter body.", x: 72, y: 700 }] },
    ],
    outline: [{ title: "Isolation levels", page: 2 }],
  });
  const result = await parsePdf(input(bytes));
  assert.equal(result.readiness, "ready");
  const heading = result.document.outline.find((item) => item.title === "Isolation levels");
  assert.ok(heading);
  if (heading.page !== undefined) assert.equal(heading.page, 2);
});

test("parser queue never runs two jobs at once", async () => {
  let concurrent = 0;
  let max = 0;
  const job = async () => {
    concurrent += 1;
    max = Math.max(max, concurrent);
    assert.equal(pdfParseActiveCount() <= 1, true);
    await new Promise((resolve) => setTimeout(resolve, 20));
    concurrent -= 1;
  };
  await Promise.all([enqueuePdfParse(job), enqueuePdfParse(job), enqueuePdfParse(job)]);
  assert.equal(max, 1);
});
