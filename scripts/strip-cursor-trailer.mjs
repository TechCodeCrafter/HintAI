#!/usr/bin/env node
/**
 * Removes the `Co-authored-by: Cursor <cursoragent@cursor.com>` trailer that
 * Cursor's Commit Attribution feature appends to agent-authored commits.
 *
 * GitHub reads that trailer as a second contributor and shows "cursoragent"
 * alongside the author on every commit and in the Contributors sidebar. Turning
 * the toggle off in Cursor Settings covers the IDE, but not commits made by
 * cloud or background agents, so this runs as a commit-msg hook and catches
 * every path into the repository.
 *
 * Two call styles, because the hook and a history rewrite need different ones:
 *   node strip-cursor-trailer.mjs <file>   rewrite a commit message in place
 *   node strip-cursor-trailer.mjs          filter stdin to stdout
 */
import { readFileSync, writeFileSync } from "node:fs";

const TRAILER = /^Co-authored-by:\s*Cursor\s*<cursoragent@cursor\.com>\s*$/i;

/** Drops the trailer, then any blank lines it left dangling at the end. */
function strip(message) {
  const kept = message.split("\n").filter((line) => !TRAILER.test(line));
  return kept.join("\n").replace(/\n+$/, "") + "\n";
}

const file = process.argv[2];

if (file) {
  const before = readFileSync(file, "utf8");
  const after = strip(before);
  // Only touch the file when there is something to remove, so an ordinary
  // commit is not rewritten (and its mtime not churned) for no reason.
  if (after !== before) writeFileSync(file, after);
} else {
  let input = "";
  process.stdin
    .on("data", (chunk) => (input += chunk))
    .on("end", () => process.stdout.write(strip(input)));
}
