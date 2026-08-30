/**
 * EvidenceSpan is the only coordinate system a file citation may quote.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { hashText, verifyClaim } from "../evidence.ts";
import {
  type EvidenceSpan,
  countLines,
  createEvidenceSpan,
  verifyEvidenceSpan,
} from "../evidence-span.ts";
import { proseOf, proseSpanInSource } from "../prose.ts";

function createSpan(content: string, start: number, end: number, contentHash = hashText(content)): EvidenceSpan {
  const span = createEvidenceSpan({
    path: "fixture.txt",
    content,
    start,
    end,
    contentHash,
    normalizedText: content.slice(start, end),
  });
  assert.ok(span, `expected a span at ${start}-${end}`);
  return span;
}

test("exact line ranges are correct", () => {
  const content = "line1\nline2\nline3\nline4\nline5";
  const start = content.indexOf("line3");
  const span = createSpan(content, start, start + "line3".length);
  assert.equal(span.startLine, 3);
  assert.equal(span.endLine, 3);
  assert.equal(countLines(content, start) + 1, 3);
});

test("file-head claims point to actual location, not line 1", () => {
  const content = "\n\n/** Docstring */\nfunction foo() {}";
  const start = content.indexOf("/**");
  const end = content.indexOf("*/") + 2;
  const span = createSpan(content, start, end);
  assert.equal(span.startLine, 3);
  assert.notEqual(span.startLine, 1);
});

test("retrieved chunk boundaries do not become fake citation lines", () => {
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  const content = lines.join("\n");
  const chunkStart = content.indexOf("line 10");
  const evidenceStart = content.indexOf("line 25");
  const evidenceEnd = content.indexOf("line 26");
  const span = createSpan(content, evidenceStart, evidenceEnd);
  assert.equal(span.startLine, 25);
  assert.notEqual(span.startLine, 10);
  assert.notEqual(span.startOffset, chunkStart);
});

test("modified source content invalidates stale evidence", () => {
  const content = "original text";
  const span = createSpan(content, 0, 13, "hash1");
  const result = verifyEvidenceSpan(span, { content: "modified text", contentHash: "hash2" });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "STALE");
});

test("unsupported text cannot speak", () => {
  const content = "actual file content";
  const span = createSpan(content, 0, content.length);
  const result = verifyClaim("this fabricated sentence mentions unicorns", [span]);
  assert.equal(result.ok, false);
});

test("text mismatch at offsets is caught", () => {
  const content = "hello world";
  const span = createSpan(content, 0, 5);
  const tampered = { ...span, text: "wrong" };
  const result = verifyEvidenceSpan(tampered, { content, contentHash: span.contentHash });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "TEXT_MISMATCH");
});

test("line numbers that disagree with offsets are rejected", () => {
  const content = "alpha\nbeta\ngamma";
  const start = content.indexOf("beta");
  const span = createSpan(content, start, start + 4);
  const tampered = { ...span, startLine: 1 };
  const result = verifyEvidenceSpan(tampered, { content, contentHash: span.contentHash });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "LINE_MISMATCH");
});

test("proseOf offsets stay in the raw source, not the spoken string", () => {
  const content = "# Title\n\nThis worker extracts biocompatibility tables from uploaded workbooks.\n";
  const prose = proseOf({ path: "notes.md", content });
  assert.ok(prose?.description);
  assert.equal(proseSpanInSource(content, prose.description), true);
  assert.equal(
    content.slice(prose.description.start, prose.description.end).includes("extracts biocompatibility"),
    true,
  );
  assert.notEqual(prose.description.start, 0);
});
