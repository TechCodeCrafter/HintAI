/**
 * The spoken claim must be supported exactly by the cited evidence, so prose
 * normalization may drop Markdown delimiters but may never alter an identifier.
 * An identifier that survives a round trip through `plain` must still be
 * greppable in the file the Card points at.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { plain } from "./prose.ts";

test("a leading underscore identifier is spoken as written", () => {
  assert.equal(plain("Consumes _bg_index events."), "Consumes _bg_index events.");
});

test("internal underscores survive", () => {
  assert.equal(plain("Reads foo_bar from some_identifier."), "Reads foo_bar from some_identifier.");
});

test("double underscore identifiers are not mistaken for bold", () => {
  assert.equal(plain("Defined in __init__ for the package."), "Defined in __init__ for the package.");
  assert.equal(plain("__init__"), "__init__");
});

test("ALL_CAPS identifiers keep their underscores", () => {
  assert.equal(plain("Retry up to MAX_RETRIES."), "Retry up to MAX_RETRIES.");
  assert.equal(plain("IN_PROGRESS means skip."), "IN_PROGRESS means skip.");
});

test("inline code loses the backticks and keeps the identifier", () => {
  assert.equal(plain("Consumes `_bg_index` events."), "Consumes _bg_index events.");
  assert.equal(plain("Retry up to `MAX_RETRIES`."), "Retry up to MAX_RETRIES.");
  assert.equal(plain("Status is `IN_PROGRESS`."), "Status is IN_PROGRESS.");
});

test("real Markdown emphasis is removed", () => {
  assert.equal(plain("**important**"), "important");
  assert.equal(plain("*note* this"), "note this");
  assert.equal(plain("***very***"), "very");
  assert.equal(plain("__two words__ of bold"), "two words of bold");
});

test("prose mixed with inline code normalizes both", () => {
  assert.equal(
    plain("The **worker** consumes `_bg_index` and writes `MAX_RETRIES` to _state_ tables."),
    "The worker consumes _bg_index and writes MAX_RETRIES to _state_ tables.",
  );
});

test("links are spoken as their text", () => {
  assert.equal(plain("See [the runbook](docs/ops.md) first."), "See the runbook first.");
});

test("every identifier in a normalized line is still findable in the source", () => {
  // The property the citation contract actually depends on.
  const source = "Consumes `_bg_index` events; on FAILED retry up to `MAX_RETRIES`, see __init__.";
  const spoken = plain(source);
  for (const token of spoken.split(/\s+/)) {
    const bare = token.replace(/^[^A-Za-z0-9_]+/, "").replace(/[^A-Za-z0-9_]+$/, "");
    if (!bare.includes("_")) continue;
    assert.ok(source.includes(bare), `${bare} is spoken but absent from the evidence`);
  }
});
