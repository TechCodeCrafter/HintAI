/**
 * Offsets survive the transforms extraction applies. Every case here is one a
 * real docstring hits on its way to being spoken, and the property that matters
 * is always the same: whatever the derived text says, the range it reports must
 * still hold that text in the original document.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  joinMapped,
  linesOf,
  mappedSlice,
  rangeOf,
  sliceMapped,
  splitMapped,
  stripLeading,
  trimMapped,
} from "./text-map.ts";

test("a slice reports the range it came from", () => {
  const content = "alpha beta gamma";
  const m = mappedSlice(content, 6, 10);
  assert.equal(m.text, "beta");
  assert.deepEqual(rangeOf(m), { start: 6, end: 10 });
  assert.equal(content.slice(6, 10), m.text);
});

test("trimming keeps the coordinates of what is left", () => {
  const content = "   padded   ";
  const m = trimMapped(mappedSlice(content));
  assert.equal(m.text, "padded");
  const range = rangeOf(m);
  assert.deepEqual(range, { start: 3, end: 9 });
  assert.equal(content.slice(range.start, range.end), "padded");
});

test("stripping a leading marker moves the start, not the end", () => {
  const content = " * a comment line";
  const m = stripLeading(mappedSlice(content), /\s*\*+\s?/);
  assert.equal(m.text, "a comment line");
  assert.equal(rangeOf(m)?.start, content.indexOf("a comment"));
});

test("a rejoined wrapped sentence spans both lines in the source", () => {
  // The shape of a hard-wrapped docstring: the derived sentence is not a
  // substring of the file, but its range still covers where it was written.
  const content = "Extracts tables\nfrom uploaded PDFs.";
  const joined = joinMapped(linesOf(mappedSlice(content)), " ");
  assert.equal(joined.text, "Extracts tables from uploaded PDFs.");
  const range = rangeOf(joined);
  assert.deepEqual(range, { start: 0, end: content.length });
  // The separator is not in the source, so the range covers the newline the
  // file actually contains — which is the honest thing to point at.
  assert.equal(content.slice(range.start, range.end), content);
});

test("splitting a paragraph gives each sentence its own true range", () => {
  const content = "First sentence here. Second sentence here.";
  const parts = splitMapped(mappedSlice(content), /(?<=[.!?])\s+/);
  assert.equal(parts.length, 2);
  for (const part of parts) {
    const range = rangeOf(part);
    assert.ok(range);
    assert.equal(content.slice(range.start, range.end), part.text);
  }
  assert.equal(rangeOf(parts[1])?.start, content.indexOf("Second"));
});

test("offsets survive slicing a derived string", () => {
  const content = "  # note: keep this\n";
  const stripped = stripLeading(trimMapped(mappedSlice(content)), /#\s*/);
  const tail = sliceMapped(stripped, stripped.text.indexOf("keep"));
  assert.equal(tail.text, "keep this");
  const range = rangeOf(tail);
  assert.ok(range);
  assert.equal(content.slice(range.start, range.end), "keep this");
});

test("an empty result reports no range rather than a wrong one", () => {
  assert.equal(rangeOf(mappedSlice("abc", 2, 2)), null);
  assert.equal(rangeOf(trimMapped(mappedSlice("   "))), null);
  assert.equal(mappedSlice("abc", 5, 9).text, "");
});

test("lines keep their own offsets, blank ones included", () => {
  const content = "one\n\nthree";
  const lines = linesOf(mappedSlice(content));
  assert.deepEqual(
    lines.map((l) => l.text),
    ["one", "", "three"],
  );
  assert.equal(rangeOf(lines[2])?.start, content.indexOf("three"));
});
