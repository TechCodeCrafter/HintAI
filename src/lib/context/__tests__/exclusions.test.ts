import assert from "node:assert/strict";
import test from "node:test";
import { allSourcesExcluded, countExcludedSources, pathExcluded } from "../exclusions.ts";

test("allSourcesExcluded is true when every source path matches", () => {
  const path = "fall-2024-artificial-intelligence-in-jewelry-design.pdf";
  assert.equal(allSourcesExcluded([], [{ path }], [path]), true);
  assert.equal(countExcludedSources([], [{ path }], [path]).excluded, 1);
});

test("allSourcesExcluded is false when at least one source remains searchable", () => {
  assert.equal(
    allSourcesExcluded([], [{ path: "guide.pdf" }, { path: "secret.pdf" }], ["secret.pdf"]),
    false,
  );
  assert.equal(countExcludedSources([], [{ path: "guide.pdf" }, { path: "secret.pdf" }], ["secret.pdf"]).excluded, 1);
});

test("pathExcluded matches basename patterns against nested paths", () => {
  assert.equal(pathExcluded("docs/readme.md", ["readme.md"]), true);
  assert.equal(pathExcluded("guide.pdf", ["other.pdf"]), false);
});
