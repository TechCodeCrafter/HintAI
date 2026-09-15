#!/usr/bin/env node
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  findCursorAttributionLines,
  isCursorAttributionLine,
  stripCursorAttribution,
} from "./cursor-attribution.mjs";

const root = join(fileURLToPath(import.meta.url), "..");
const stripCli = join(root, "strip-cursor-trailer.mjs");

// --- unit: detection ---

assert.equal(isCursorAttributionLine("Co-authored-by: Cursor <cursoragent@cursor.com>"), true);
assert.equal(isCursorAttributionLine("Co-authored-by: Cursor Agent <cursor@cursor.com>"), true);
assert.equal(isCursorAttributionLine("Authored-by: Cursor <cursoragent@cursor.com>"), true);
assert.equal(isCursorAttributionLine("Made-with: Cursor"), true);

assert.equal(isCursorAttributionLine("Co-authored-by: Jane Doe <jane@company.com>"), false);
assert.equal(isCursorAttributionLine("Co-authored-by: John Cursor <john@company.com>"), false);
assert.equal(isCursorAttributionLine("Co-authored-by: Alice <alice@example.com>"), false);

// --- strip: Cursor removed ---

assert.equal(
  stripCursorAttribution("feat: test\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n"),
  "feat: test\n",
);

assert.equal(
  stripCursorAttribution(
    "fix: multi\n\nCo-authored-by: Jane Doe <jane@company.com>\nCo-authored-by: Cursor <cursoragent@cursor.com>\n",
  ),
  "fix: multi\n\nCo-authored-by: Jane Doe <jane@company.com>\n",
);

// --- preserve human co-author ---

const humanOnly =
  "feat: pair programming\n\nCo-authored-by: Jane Doe <jane@company.com>\n";
assert.equal(stripCursorAttribution(humanOnly), humanOnly);

// --- normal commit unchanged ---

const normal = "chore: bump deps\n\nNo trailers here.\n";
assert.equal(stripCursorAttribution(normal), normal);

assert.deepEqual(findCursorAttributionLines(humanOnly), []);
assert.deepEqual(findCursorAttributionLines("Made-with: Cursor\n"), ["Made-with: Cursor"]);

// --- CLI hook path ---

const dir = mkdtempSync(join(tmpdir(), "strip-trailer-"));
const file = join(dir, "msg");
writeFileSync(
  file,
  "feat: hook\n\nCo-authored-by: Jane Doe <jane@company.com>\nCo-authored-by: Cursor <cursoragent@cursor.com>\n",
);
execSync(`node ${stripCli} ${file}`);
assert.equal(
  readFileSync(file, "utf8"),
  "feat: hook\n\nCo-authored-by: Jane Doe <jane@company.com>\n",
);

console.log("strip-cursor-trailer.test.mjs: ok");
