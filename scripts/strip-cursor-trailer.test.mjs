#!/usr/bin/env node
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(import.meta.url), "..");
const strip = join(root, "strip-cursor-trailer.mjs");

const dir = mkdtempSync(join(tmpdir(), "strip-trailer-"));
const file = join(dir, "msg");
writeFileSync(
  file,
  "feat: test\n\nCo-authored-by: Cursor <cursoragent@cursor.com>\n",
);
execSync(`node ${strip} ${file}`);
assert.equal(readFileSync(file, "utf8"), "feat: test\n");

writeFileSync(file, "fix: x\n\nAuthored-by: Cursor <cursoragent@cursor.com>\n");
execSync(`node ${strip} ${file}`);
assert.equal(readFileSync(file, "utf8"), "fix: x\n");

console.log("strip-cursor-trailer.test.mjs: ok");
