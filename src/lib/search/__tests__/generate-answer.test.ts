import assert from "node:assert/strict";
import { test } from "node:test";

import type { FileHit } from "../../repo/types.ts";
import {
  buildAnswerPrompt,
  citationsFromHits,
  hitsGroundAnswer,
} from "../generate-answer.ts";

function hit(over: Partial<FileHit> & Pick<FileHit, "score" | "path" | "text">): FileHit {
  return {
    id: over.id ?? `${over.path}:1-8`,
    kind: "code",
    startLine: 4,
    endLine: 12,
    startOffset: 0,
    ...over,
  };
}

test("strong retrieval counts as evidence", () => {
  assert.equal(hitsGroundAnswer([]), false);
  assert.equal(hitsGroundAnswer([hit({ score: 2.5, path: "a.ts", text: "x" })]), false);
  assert.equal(hitsGroundAnswer([hit({ score: 4, path: "a.ts", text: "x" })]), true);
});

test("two hits in the same file become one citation", () => {
  const cites = citationsFromHits([
    hit({ score: 8, path: "src/exporter/retry.ts", text: "MAX_ATTEMPTS = 3", startLine: 12 }),
    hit({ score: 6, path: "src/exporter/retry.ts", text: "export retries", startLine: 4 }),
  ]);
  assert.equal(cites.length, 1);
  if (cites[0]?.kind === "file") {
    assert.equal(cites[0].path, "src/exporter/retry.ts");
    assert.equal(cites[0].line, 12);
  }
});

test("citations come from the top hits, not invented paths", () => {
  const cites = citationsFromHits([
    hit({ score: 8, path: "src/exporter/retry.ts", text: "MAX_ATTEMPTS = 3", startLine: 12 }),
    hit({ score: 5, path: "docs/adr.md", text: "retries", startLine: 8 }),
  ]);
  assert.equal(cites.length, 2);
  assert.equal(cites[0]?.kind, "file");
  if (cites[0]?.kind === "file") {
    assert.equal(cites[0].path, "src/exporter/retry.ts");
    assert.equal(cites[0].line, 12);
  }
});

test("the answer prompt includes the question and retrieved files", () => {
  const prompt = buildAnswerPrompt(
    "Why does that retry three times?",
    [hit({ score: 8, path: "src/exporter/retry.ts", text: "Attempts are capped at three.", startLine: 4 })],
    ["Why does export fail?"],
  );
  assert.match(prompt, /Why does that retry three times/);
  assert.match(prompt, /src\/exporter\/retry\.ts:4/);
  assert.match(prompt, /Attempts are capped at three/);
  assert.match(prompt, /Why does export fail/);
  assert.match(prompt, /paraphrase/i);
});
