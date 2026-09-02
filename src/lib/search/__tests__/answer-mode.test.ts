import assert from "node:assert/strict";
import { test } from "node:test";

import { modeLabel } from "../answer-mode.ts";
import { applyAssist, silentAssist } from "../assist.ts";
import { applyPolish } from "../polish.ts";
import type { Card, FileCitation } from "../../repo/types.ts";

const cite: FileCitation = {
  kind: "file",
  path: "src/exporter/retry.ts",
  line: 12,
  label: "src/exporter/retry.ts",
};

const evidenceCard: Card = {
  say: "Retries stop at three so a fourth attempt does not duplicate the file.",
  citations: [cite],
  query: "Why does that retry three times?",
  latencyMs: 8,
  source: "local",
  answerMode: "docs",
  evidence: [
    {
      kind: "text",
      text: "Attempts are capped at three because a fourth attempt duplicates the settlement file instead of recovering it.",
    },
  ] as Card["evidence"],
};

test("the card badge is always from your files", () => {
  assert.equal(modeLabel(), "From your files");
  assert.equal(modeLabel("docs"), "From your files");
});

test("polish keeps a rewrite only when every word is still in the evidence", () => {
  const polished = applyPolish(evidenceCard, "Retries stop at three so a fourth attempt does not duplicate the file.", 40);
  assert.equal(polished.answerMode, "docs");
  assert.equal(polished.say, evidenceCard.say);
  const rewritten = applyPolish(evidenceCard, "Attempts are capped at three so a fourth attempt duplicates the file.", 40);
  assert.equal(rewritten.answerMode, "docs");
  assert.equal(rewritten.say, "Attempts are capped at three so a fourth attempt duplicates the file.");
  assert.deepEqual(rewritten.citations, evidenceCard.citations);
  const invented = applyPolish(evidenceCard, "Tokyo weather is generated from general knowledge.", 10);
  assert.equal(invented.say, evidenceCard.say);
  assert.equal(invented.answerMode, "docs");
  const kept = applyPolish({ ...evidenceCard, evidence: [] }, "Reworded.", 10);
  assert.equal(kept.say, evidenceCard.say);
  assert.deepEqual(kept.evidence, []);
});

test("an unchanged or empty polish stays docs", () => {
  assert.equal(applyPolish(evidenceCard, evidenceCard.say, 12).answerMode, "docs");
  assert.equal(applyPolish(evidenceCard, null, 12).answerMode, "docs");
});

test("assist never speaks — cite or silence", () => {
  const assisted = applyAssist("What is a quorum lease?", "A lock that several nodes must renew.", 30);
  assert.equal(assisted.say, null);
  assert.equal(assisted.answerMode, "docs");
  assert.equal(assisted.citations.length, 0);
  const silent = silentAssist("What is a quorum lease?", "Nothing to suggest.");
  assert.equal(silent.say, null);
  assert.equal(silent.citations.length, 0);
  assert.equal(silent.answerMode, "docs");
});
