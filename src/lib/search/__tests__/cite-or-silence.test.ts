import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  AUTH_SERVICE_CLAIM,
  AUTH_SERVICE_LINE,
  AUTH_SERVICE_PATH,
  HOME_PROOF_CHIPS,
  HOME_TRY_QUESTION,
  NORTHSTAR,
} from "../../repo/northstar.ts";
import { truncationNotice } from "../../repo/folder.ts";
import { localCard } from "../local-card.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../../..");
const chunks = buildChunks(NORTHSTAR);

test("search() never generates — retrieve, then localCard, then admit", () => {
  const store = readFileSync(join(root, "src/lib/store.ts"), "utf8");
  const synthesis = readFileSync(join(root, "src/lib/search/generate-answer.ts"), "utf8");
  assert.doesNotMatch(synthesis, /answer from general knowledge/i);
  assert.doesNotMatch(synthesis, /buildAnswerPrompt/);
  assert.match(synthesis, /buildSynthesisPrompt/);
  assert.doesNotMatch(store, /hitsGroundAnswer/);
  assert.doesNotMatch(store, /speakAnswer/);
  assert.doesNotMatch(store, /craftCard/);
  assert.match(store, /retrieveHits/);
  assert.match(store, /localCard\(/);
  assert.match(store, /mode === "synthesize" && state.subscription === "free"/);
  assert.match(store, /Synthesize mode requires Pro/);
  assert.match(store, /Claim Audit requires Pro/);
  const searchFn = store.slice(store.indexOf("search: async"));
  const extract = searchFn.slice(searchFn.indexOf("const documents = await documentsForHits"));
  assert.match(extract, /localCard\(/);
  assert.doesNotMatch(extract.slice(0, 800), /generateAnswer\s*\(/);
  assert.doesNotMatch(searchFn.slice(0, 2500), /claimAdmit|isClaimLine|admitHeardClaim/);
});

test("a truncated pack tells the user to load a service folder", () => {
  assert.match(truncationNotice(160), /Loaded 160 files/);
  assert.match(truncationNotice(160), /service folder \(src\/\)/);
});

test("a question the pack cannot cite stays silent", () => {
  const weather = localCard("What is the weather in Tokyo today?", retrieve("What is the weather in Tokyo today?", chunks), NORTHSTAR, 0);
  assert.equal(weather.say, null);
  assert.equal((weather.citations ?? []).length, 0);

  const cards = localCard("Do we store card numbers in the export?", retrieve("Do we store card numbers in the export?", chunks), NORTHSTAR, 0);
  assert.equal(cards.say, null);
});

test("a question the files can admit speaks the cited line", () => {
  const card = localCard("Why does that retry three times?", retrieve("Why does that retry three times?", chunks), NORTHSTAR, 0);
  assert.ok(card.say);
  assert.match(card.say, /three/i);
  assert.ok(card.citations.some((c) => "path" in c && String(c.path).includes("retry")));
});

test("the first-visit chips extract a cited line", () => {
  for (const question of HOME_PROOF_CHIPS) {
    const card = localCard(question, retrieve(question, chunks), NORTHSTAR, 0);
    assert.ok(card.say, `silent on: ${question}`);
    assert.ok(card.citations.length > 0, `no cite for: ${question}`);
  }
});

test("the auth service question cites src/auth.ts line 47", () => {
  const card = localCard(HOME_TRY_QUESTION, retrieve(HOME_TRY_QUESTION, chunks), NORTHSTAR, 0);
  assert.equal(card.say, AUTH_SERVICE_CLAIM);
  const cite = card.citations.find((c) => c.kind === "file");
  assert.ok(cite && cite.kind === "file");
  assert.equal(cite.path, AUTH_SERVICE_PATH);
  assert.equal(cite.line, AUTH_SERVICE_LINE);
});
