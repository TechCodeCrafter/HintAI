import assert from "node:assert/strict";
import { test } from "node:test";

import { modeLabel, readStoredAnswerMode, shouldCiteFromDocs } from "../answer-mode.ts";
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
  answerMode: "grounded",
};

test("mode labels are the ones the card shows", () => {
  assert.equal(modeLabel("docs"), "From your docs");
  assert.equal(modeLabel("grounded"), "From your docs");
  assert.equal(modeLabel("free"), "Generated");
  assert.equal(modeLabel("assisted"), "Generated");
});

test("older three-mode names map onto the two live modes", () => {
  assert.equal(readStoredAnswerMode("grounded"), "docs");
  assert.equal(readStoredAnswerMode("polished"), "docs");
  assert.equal(readStoredAnswerMode("assisted"), "free");
  assert.equal(readStoredAnswerMode("docs"), "docs");
  assert.equal(readStoredAnswerMode(null), "docs");
});

test("only From my docs may attach citations", () => {
  assert.equal(shouldCiteFromDocs("docs"), true);
  assert.equal(shouldCiteFromDocs("free"), false);
});

test("polish keeps the original citations and evidence", () => {
  const polished = applyPolish(evidenceCard, "We cap retries at three to avoid a duplicate export.", 40);
  assert.equal(polished.answerMode, "polished");
  assert.equal(polished.source, "polished");
  assert.equal(polished.say, "We cap retries at three to avoid a duplicate export.");
  assert.deepEqual(polished.citations, evidenceCard.citations);
  const kept = applyPolish({ ...evidenceCard, evidence: [] }, "Reworded.", 10);
  assert.deepEqual(kept.evidence, []);
});

test("an unchanged or empty polish stays grounded", () => {
  assert.equal(applyPolish(evidenceCard, evidenceCard.say, 12).answerMode, "grounded");
  assert.equal(applyPolish(evidenceCard, null, 12).answerMode, "grounded");
});

test("assist never carries a file citation", () => {
  const assisted = applyAssist("What is a quorum lease?", "A lock that several nodes must renew.", 30);
  assert.equal(assisted.answerMode, "assisted");
  assert.equal(assisted.source, "assisted");
  assert.equal(assisted.citations.length, 0);
  assert.equal(assisted.evidence, undefined);
  const silent = silentAssist("What is a quorum lease?", "Nothing to suggest.");
  assert.equal(silent.say, null);
  assert.equal(silent.citations.length, 0);
  assert.equal(silent.answerMode, "grounded");
});
