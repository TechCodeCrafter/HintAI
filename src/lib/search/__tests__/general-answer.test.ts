import assert from "node:assert/strict";
import { test } from "node:test";

import { buildGeneralPrompt, stripCitationShapes, generalAnswer } from "../general-answer.ts";
import { isGeneralAnswer, modeLabel } from "../answer-mode.ts";

test("buildGeneralPrompt never includes retrieved chunks", () => {
  const prompt = buildGeneralPrompt("What is a mutex?", ["What is a lock?"]);
  assert.match(prompt, /mutex/);
  assert.match(prompt, /general knowledge/i);
  // No chunk placeholder, no evidence section
  assert.doesNotMatch(prompt, /chunk/i);
  assert.doesNotMatch(prompt, /evidence/i);
});

test("stripCitationShapes removes citation markers", () => {
  assert.equal(stripCitationShapes("See [1] for details."), "See for details.");
  assert.equal(stripCitationShapes("In src/app.ts:42 we define it."), "In we define it.");
  assert.equal(stripCitationShapes("As file: report.pdf shows."), "As shows.");
  assert.equal(stripCitationShapes("On line 12 of the doc."), "On of the doc.");
  // Plain prose survives
  assert.equal(stripCitationShapes("A mutex guards shared state."), "A mutex guards shared state.");
});

test("general answer mode is labeled and distinct", () => {
  assert.ok(isGeneralAnswer("general"));
  assert.ok(!isGeneralAnswer("docs"));
  assert.equal(modeLabel("general"), "General knowledge");
  assert.equal(modeLabel("docs"), "From your files");
});

test("generalAnswer returns no citation fields by construction", async () => {
  const result = await generalAnswer("What is a mutex?", performance.now(), {
    ask: async () => ({ text: "A mutex guards shared state. [1]", modelName: "test" }),
  });
  assert.ok(result.ok);
  if (result.ok) {
    // Citation marker stripped, no citation/evidence fields exist on the type
    assert.doesNotMatch(result.say, /\[\d+\]/);
    assert.ok(!("citations" in result));
    assert.ok(!("evidence" in result));
  }
});

test("generalAnswer treats INSUFFICIENT as failure", async () => {
  const result = await generalAnswer("xyzzy", performance.now(), {
    ask: async () => ({ text: "INSUFFICIENT", modelName: "test" }),
  });
  assert.ok(!result.ok);
});
