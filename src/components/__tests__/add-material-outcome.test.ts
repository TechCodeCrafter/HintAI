import assert from "node:assert/strict";
import { test } from "node:test";

import {
  combineAddOutcomes,
  describeAddStep,
  indexingView,
  marksFromSources,
  type SourceMark,
} from "../add-material-outcome.ts";
import type { PdfStoredSource, TextStoredSource } from "../../lib/context/types.ts";

const existing: SourceMark[] = [
  { key: "a", updatedAt: 1, name: "src/a.ts" },
  { key: "b", updatedAt: 1, name: "src/b.ts" },
];
const NO_FILES = "No readable source files in that selection. Pick source, markdown, text, or office files.";

test("zero readable files in a space with material: failure, says existing material is kept", () => {
  const out = describeAddStep({ kind: "files", before: existing, after: existing, folderError: NO_FILES });
  assert.equal(out.tone, "error");
  assert.equal(out.text, `Nothing was added. ${NO_FILES} Your existing material is unchanged.`);
  assert.doesNotMatch(out.text, /added\.$|Material added/);
});

test("zero readable files in an empty space: failure without claiming anything was kept", () => {
  const out = describeAddStep({ kind: "files", before: [], after: [], folderError: NO_FILES });
  assert.equal(out.tone, "error");
  assert.equal(out.text, `Nothing was added. ${NO_FILES}`);
});

test("status ready alone is not success: no change and no error is still reported as nothing added", () => {
  const out = describeAddStep({ kind: "files", before: existing, after: existing, folderError: null });
  assert.equal(out.tone, "error");
  assert.match(out.text, /^Nothing new was added\./);
});

test("thrown error with no change", () => {
  const out = describeAddStep({ kind: "pdfs", before: existing, after: existing, folderError: null, threw: true });
  assert.equal(out.tone, "error");
  assert.equal(out.text, "Could not add those PDFs. Try again, or pick different files. Your existing material is unchanged.");
});

test("save failure reported only via contextError", () => {
  const out = describeAddStep({
    kind: "files",
    before: [],
    after: [],
    folderError: null,
    contextError: "Could not save that material.",
  });
  assert.equal(out.tone, "error");
  assert.equal(out.text, "Nothing was added. Could not save that material.");
});

test("rejected PDFs keep the store's per-file reason", () => {
  const out = describeAddStep({
    kind: "pdfs",
    before: existing,
    after: existing,
    folderError: "notes.pdf: Not a PDF.",
  });
  assert.equal(out.text, "Nothing was added. notes.pdf: Not a PDF. Your existing material is unchanged.");
});

test("store copy that already says nothing was added / material unchanged is not repeated", () => {
  const a = describeAddStep({
    kind: "files",
    before: existing,
    after: existing,
    folderError: "Could not read those files. Nothing was added.",
  });
  assert.equal(a.text, "Could not read those files. Nothing was added. Your existing material is unchanged.");
  const b = describeAddStep({
    kind: "files",
    before: existing,
    after: existing,
    folderError: "Could not save that material. Your existing material is unchanged.",
  });
  assert.equal(b.text, "Nothing was added. Could not save that material. Your existing material is unchanged.");
  assert.equal((b.text.match(/unchanged/g) ?? []).length, 1);
});

test("clean success", () => {
  const after = [...existing, { key: "c", updatedAt: 2, name: "src/c.ts" }];
  assert.deepEqual(describeAddStep({ kind: "files", before: existing, after, folderError: null }), {
    tone: "ok",
    text: "Material added.",
  });
});

test("success with some office files unreadable is a warning, not plain success", () => {
  const after = [...existing, { key: "c", updatedAt: 2, name: "notes.md" }];
  const out = describeAddStep({
    kind: "files",
    before: existing,
    after,
    folderError: "Could not read plan.docx. Save it again or export it as PDF.",
  });
  assert.equal(out.tone, "warn");
  assert.equal(out.text, "Some material was added. Could not read plan.docx. Save it again or export it as PDF.");
});

test("PDF stored but unreadable counts as a failure for that PDF", () => {
  const after = [...existing, { key: "p", updatedAt: 2, name: "scan.pdf", problem: "Scanned PDF" }];
  const out = describeAddStep({ kind: "pdfs", before: existing, after, folderError: null });
  assert.equal(out.tone, "error");
  assert.equal(out.text, "Could not use scan.pdf (Scanned PDF). Open the source list for details.");
});

test("mixed drop: files failed, PDFs added -> the files failure survives", () => {
  const files = describeAddStep({ kind: "files", before: existing, after: existing, folderError: NO_FILES });
  const withPdf = [...existing, { key: "p", updatedAt: 2, name: "a.pdf" }];
  const pdfs = describeAddStep({ kind: "pdfs", before: existing, after: withPdf, folderError: null });
  const out = combineAddOutcomes([files, pdfs]);
  assert.equal(out?.tone, "warn");
  assert.equal(out?.text, `Some material was added. ${NO_FILES}`);
});

test("mixed drop: both fail", () => {
  const files = describeAddStep({ kind: "files", before: [], after: [], folderError: NO_FILES });
  const pdfs = describeAddStep({ kind: "pdfs", before: [], after: [], folderError: "a.pdf: Not a PDF." });
  const out = combineAddOutcomes([files, pdfs]);
  assert.equal(out?.tone, "error");
  assert.equal(out?.text, `Nothing was added. ${NO_FILES} a.pdf: Not a PDF.`);
});

test("no exclamation points or emoji in any copy", () => {
  const outs = [
    describeAddStep({ kind: "files", before: existing, after: existing, folderError: NO_FILES }),
    describeAddStep({ kind: "files", before: existing, after: existing, folderError: null, threw: true }),
    describeAddStep({ kind: "files", before: [], after: [{ key: "x", updatedAt: 1, name: "x" }], folderError: null }),
  ];
  for (const out of outs) assert.doesNotMatch(out.text, /!|\p{Extended_Pictographic}/u);
});

test("marksFromSources flags unreadable PDFs but not pending ones or text files", () => {
  const text = { id: "t1", sourceId: "s", kind: "file", path: "src/a.ts", displayName: "repo", updatedAt: 5 } as TextStoredSource;
  const base = { sourceId: "p", kind: "pdf", sourceType: "pdf", displayName: "doc", path: "docs/doc.pdf", updatedAt: 5 };
  const scanned = { ...base, id: "p1", readiness: "scanned" } as PdfStoredSource;
  const pending = { ...base, id: "p2", readiness: "pending" } as PdfStoredSource;
  const ready = { ...base, id: "p3", readiness: "ready" } as PdfStoredSource;
  const marks = marksFromSources([text, scanned, pending, ready]);
  assert.deepEqual(
    marks.map((m) => [m.key, m.name, m.problem ?? null]),
    [
      ["t1", "src/a.ts", null],
      ["p1", "doc.pdf", "Scanned PDF"],
      ["p2", "doc.pdf", null],
      ["p3", "doc.pdf", null],
    ],
  );
});

test("create flow: a corrupt PDF stored as an unreadable source is a failure, not Ready", () => {
  // The old create screen said Ready whenever sources.length > 0 and status was "ready".
  // This PDF is stored (sources.length === 1) with nothing searchable.
  const corrupt = {
    id: "pdf-1",
    sourceId: "pdf-1",
    kind: "pdf",
    sourceType: "pdf",
    // Real rows store the name without its extension; the path keeps it.
    displayName: "broken",
    path: "broken.pdf",
    readiness: "unreadable",
    readinessNote: "parse failed",
    updatedAt: 10,
  } as PdfStoredSource;
  const outcome = describeAddStep({
    kind: "pdfs",
    before: [],
    after: marksFromSources([corrupt]),
    folderError: null,
    unusableHint: "Choose a different file.",
  });
  assert.equal(outcome.tone, "error");
  assert.equal(outcome.reason, "Could not use broken.pdf (Cannot read). Choose a different file.");
  assert.equal(indexingView({ adding: false, outcome, onTarget: true }), "failed");
});

test("create flow: scanned PDF names the reason", () => {
  const scanned = {
    id: "pdf-2", sourceId: "pdf-2", kind: "pdf", sourceType: "pdf", displayName: "x.pdf", path: "x.pdf",
    readiness: "scanned", updatedAt: 3,
  } as PdfStoredSource;
  const outcome = describeAddStep({ kind: "pdfs", before: [], after: marksFromSources([scanned]), folderError: null });
  assert.match(outcome.text, /^Could not use x\.pdf \(Scanned PDF\)\./);
});

test("create flow view: working, ready, partial ready, off-target, no outcome", () => {
  const ok = { tone: "ok", text: "Material added." } as const;
  const warn = { tone: "warn", text: "Some material was added. Could not use a.pdf (Cannot read).", reason: "x" } as const;
  assert.equal(indexingView({ adding: true, outcome: null, onTarget: true }), "working");
  assert.equal(indexingView({ adding: false, outcome: ok, onTarget: true }), "ready");
  assert.equal(indexingView({ adding: false, outcome: warn, onTarget: true }), "ready");
  assert.equal(indexingView({ adding: false, outcome: ok, onTarget: false }), "failed");
  // Never left on "working" once the work is over, even without an outcome.
  assert.equal(indexingView({ adding: false, outcome: null, onTarget: true }), "failed");
});

test("combined failure carries a bare reason for screens that already say nothing was indexed", () => {
  const files = describeAddStep({ kind: "files", before: [], after: [], folderError: "All 2 selected files were images." });
  assert.equal(files.reason, "All 2 selected files were images.");
  const pdfs = describeAddStep({ kind: "pdfs", before: [], after: [], folderError: "a.pdf: Not a PDF." });
  assert.equal(combineAddOutcomes([files, pdfs])?.reason, "All 2 selected files were images. a.pdf: Not a PDF.");
});
