#!/usr/bin/env node
/**
 * commit-msg / prepare-commit-msg hook: strip Cursor attribution only.
 *
 *   node strip-cursor-trailer.mjs <file>   rewrite a commit message in place
 *   node strip-cursor-trailer.mjs          filter stdin to stdout
 */
import { readFileSync, writeFileSync } from "node:fs";
import { stripCursorAttribution } from "./cursor-attribution.mjs";

const file = process.argv[2];

if (file) {
  const before = readFileSync(file, "utf8");
  const after = stripCursorAttribution(before);
  if (after !== before) writeFileSync(file, after);
} else {
  let input = "";
  process.stdin
    .on("data", (chunk) => (input += chunk))
    .on("end", () => process.stdout.write(stripCursorAttribution(input)));
}
