import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import { isFileHit } from "../../repo/types.ts";
import {
  buildSynthesisPrompt,
  citationIndexes,
  generateAnswer,
  stripCitationMarkers,
} from "../generate-answer.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../generate-answer.ts"), "utf8");
const chunks = buildChunks(NORTHSTAR);
const retryHits = retrieve("Why does that retry three times?", chunks).filter(isFileHit);

function ask(text: string) {
  return async () => ({ text });
}

test("buildAnswerPrompt is gone and the prompt is grounded", () => {
  assert.doesNotMatch(source, /buildAnswerPrompt/);
  assert.doesNotMatch(source, /answer from general knowledge/i);
  const prompt = buildSynthesisPrompt("Why does that retry three times?", retryHits);
  assert.match(
    prompt,
    /If the documents do not contain enough information to answer, respond with exactly: INSUFFICIENT/,
  );
  assert.match(prompt, /ONLY the document chunks/);
  assert.match(prompt, /NEVER use general knowledge/);
  assert.match(prompt, /1-2 sentences/);
  assert.match(prompt, /\[1\]/);
});

test("INSUFFICIENT is silence", async () => {
  const generated = await generateAnswer("What is the weather in Tokyo?", retryHits, 0, {
    ask: ask("INSUFFICIENT"),
    pack: NORTHSTAR,
  });
  assert.equal(generated, null);
});

test("a cited line the files can admit is returned with real citations", async () => {
  const body = retryHits.findIndex((hit) => /Attempts are capped at three/.test(hit.text));
  assert.ok(body >= 0);
  const generated = await generateAnswer("Why does that retry three times?", retryHits, 0, {
    ask: ask(
      `Attempts are capped at three because a fourth attempt duplicates the settlement file. [${body + 1}]`,
    ),
    pack: NORTHSTAR,
  });
  assert.ok(generated);
  assert.equal(generated.usedEvidence, true);
  assert.match(generated.say, /capped at three/i);
  assert.doesNotMatch(generated.say, /\[\d+\]/);
  assert.ok(generated.citations.length >= 1);
  const cite = generated.citations.find((c) => c.kind === "file");
  assert.ok(cite && cite.kind === "file");
  assert.match(cite.path, /retry\.ts|exporter-retries/);
  assert.ok(cite.line >= 1);
  assert.ok((cite.endLine ?? cite.line) >= cite.line);
});

test("unverified synthesis is silence", async () => {
  const invented = await generateAnswer("Why does that retry three times?", retryHits, 0, {
    ask: ask("SSO ships by Q2 and the capital of France is Paris. [1]"),
    pack: NORTHSTAR,
  });
  assert.equal(invented, null);

  const unmarked = await generateAnswer("Why does that retry three times?", retryHits, 0, {
    ask: ask("Attempts are capped at three because a fourth attempt duplicates the settlement file."),
    pack: NORTHSTAR,
  });
  assert.equal(unmarked, null);
});

test("citation markers map to hit indexes", () => {
  assert.deepEqual(citationIndexes("one [1] then [2] and [1] again"), [1, 2]);
  assert.equal(stripCitationMarkers("Attempts are capped at three. [1]"), "Attempts are capped at three.");
});

test("empty hits stay silent without calling the model", async () => {
  let called = false;
  const generated = await generateAnswer("Why?", [], 0, {
    ask: async () => {
      called = true;
      return { text: "anything [1]" };
    },
  });
  assert.equal(generated, null);
  assert.equal(called, false);
});
