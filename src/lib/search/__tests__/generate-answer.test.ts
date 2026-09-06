import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import { isFileHit } from "../../repo/types.ts";
import {
  buildFreelyPrompt,
  buildSynthesisPrompt,
  buildWeakEvidencePrompt,
  citationIndexes,
  extractAnswer,
  extractBestSentence,
  freelyAnswer,
  generateAnswer,
  generateGeneralAnswer,
  synthesizeAnswer,
  stripCitationMarkers,
} from "../generate-answer.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const source = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../generate-answer.ts"), "utf8");
const chunks = buildChunks(NORTHSTAR);
const retryHits = retrieve("Why does that retry three times?", chunks).filter(isFileHit);

function ask(text: string) {
  return async () => ({ text });
}

test("extract stays grounded; weak and freely may use general knowledge", () => {
  assert.doesNotMatch(source, /buildAnswerPrompt/);
  const prompt = buildSynthesisPrompt("Why does that retry three times?", retryHits);
  assert.match(
    prompt,
    /If the documents do not contain enough information to answer, respond with exactly: INSUFFICIENT/,
  );
  assert.match(prompt, /ONLY the document chunks/);
  assert.match(prompt, /NEVER use general knowledge/);
  assert.match(prompt, /1-2 sentences/);
  assert.match(prompt, /\[1\]/);
  const weak = buildWeakEvidencePrompt("full stack developer role", retryHits);
  assert.match(weak, /Use them if they help answer the question/);
  assert.match(weak, /use your general knowledge/);
  const free = buildFreelyPrompt("What is a full stack developer?");
  assert.match(free, /Answer from general knowledge/);
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
  assert.equal(generated.answerMode, "docs");
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

test("maxTokens is forwarded to the ask", async () => {
  let seen: number | undefined;
  await generateAnswer("Why does that retry three times?", retryHits, 0, {
    maxTokens: 250,
    pack: NORTHSTAR,
    ask: async (payload) => {
      seen = payload.maxTokens;
      return { text: "INSUFFICIENT" };
    },
  });
  assert.equal(seen, 250);
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

test("extractAnswer reads a sentence from the top hit", async () => {
  const hit = retryHits[0];
  assert.ok(hit);
  const generated = await extractAnswer("Why does that retry three times?", hit, 0, { pack: NORTHSTAR });
  assert.ok(generated);
  assert.equal(generated.answerMode, "docs");
  assert.equal(generated.usedEvidence, true);
  assert.ok(generated.citations.length >= 1);
  assert.match(extractBestSentence(hit.text, "retry three times"), /retry|three|attempt/i);
});

test("weak evidence may speak without a citation", async () => {
  const generated = await synthesizeAnswer("Who is a full stack developer?", retryHits, 0, {
    ask: ask("A full-stack developer works across the client and the server."),
    pack: NORTHSTAR,
  });
  assert.ok(generated);
  assert.equal(generated.answerMode, "synthesized");
  assert.equal(generated.usedEvidence, false);
  assert.equal(generated.citations.length, 0);
  assert.match(generated.say, /full-stack/i);
});

test("generateGeneralAnswer returns a spoken line with no citations and skips verifyClaim", async () => {
  const generated = await generateGeneralAnswer("What is the weather in Tokyo?", 0, {
    ask: ask("Tokyo weather is set by Pacific high-pressure systems this week."),
  });
  assert.ok(generated);
  assert.equal(generated.usedEvidence, false);
  assert.deepEqual(generated.citations, []);
  assert.equal(generated.answerMode, "generated");
  assert.match(generated.say, /Tokyo/);
  const start = source.indexOf("export async function generateGeneralAnswer");
  const next = source.indexOf("\nexport async function", start + 10);
  const body = source.slice(start, next === -1 ? undefined : next);
  assert.doesNotMatch(body, /verifyClaim/);
  assert.doesNotMatch(body, /evidenceForMarkers/);
  assert.match(source, /Answer in 1-2 short spoken sentences/);
});

test("freely answers from general knowledge with no hits", async () => {
  let seen: string | undefined;
  const generated = await freelyAnswer("What is a full stack developer?", 0, {
    ask: async (payload) => {
      seen = payload.policy;
      return { text: "Someone who builds both the interface and the server." };
    },
  });
  assert.equal(seen, "freely");
  assert.ok(generated);
  assert.equal(generated.answerMode, "generated");
  assert.equal(generated.citations.length, 0);
  assert.match(generated.say, /interface/i);
});
